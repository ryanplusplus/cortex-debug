import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { ProviderResult } from 'vscode';
import { NodeSetting } from '../../common';
import reporting from '../../reporting';
import { PeripheralBaseNode } from './nodes/basenode';
import { PeripheralNode } from './nodes/peripheralnode';
import { SVDParser } from '../svd';
import { MessageNode } from './nodes/messagenode';

export class PeripheralTreeProvider implements vscode.TreeDataProvider<PeripheralBaseNode> {
    // tslint:disable-next-line:variable-name
    public _onDidChangeTreeData: vscode.EventEmitter<PeripheralBaseNode | undefined> = new vscode.EventEmitter<PeripheralBaseNode | undefined>();
    public readonly onDidChangeTreeData: vscode.Event<PeripheralBaseNode | undefined> = this._onDidChangeTreeData.event;
    
    private peripherials: PeripheralNode[] = [];
    private loaded: boolean = false;
    
    constructor() {

    }

    private saveState(path: string): void {
        const state: NodeSetting[] = [];
        this.peripherials.forEach((p) => {
            state.push(... p.saveState());
        });
        
        fs.writeFileSync(path, JSON.stringify(state), { encoding: 'utf8', flag: 'w' });
    }
    
    private loadSVD(SVDFile: string): Thenable<any> {
        if (!path.isAbsolute(SVDFile)) {
            const fullpath = path.normalize(path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, SVDFile));
            SVDFile = fullpath;
        }

        return SVDParser.parseSVD(SVDFile).then((peripherals) => {
            this.peripherials = peripherals;
            this.loaded = true;
            return true;
        });
    }

    private findNodeByPath(path: string): PeripheralBaseNode {
        const pathParts = path.split('.');
        const peripheral = this.peripherials.find((p) => p.name === pathParts[0]);
        if (!peripheral) { return null; }
        
        return peripheral.findByPath(pathParts.slice(1));
    }

    public refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    public getTreeItem(element: PeripheralBaseNode): vscode.TreeItem | Promise<vscode.TreeItem> {
        return element.getTreeItem();
    }

    public getChildren(element?: PeripheralBaseNode): ProviderResult<PeripheralBaseNode[]> {
        if (this.loaded && this.peripherials.length > 0) {
            if (element) {
                return element.getChildren();
            }
            else {
                return this.peripherials;
            }
        }
        else if (!this.loaded) {
            return [new MessageNode('No SVD File Loaded', null)];
        }
        else {
            return [];
        }
    }

    public debugSessionStarted(svdfile: string): Thenable<any> {
        return new Promise((resolve, reject) => {
            this.peripherials = [];
            this.loaded = false;
            this._onDidChangeTreeData.fire();
            
            if (svdfile) {
                setTimeout(() => {
                    this.loadSVD(svdfile).then(
                        () => {
                            vscode.workspace.findFiles('.vscode/.cortex-debug.peripherals.state.json', null, 1).then((value) => {
                                if (value.length > 0) {
                                    const fspath = value[0].fsPath;
                                    const data = fs.readFileSync(fspath, 'utf8');
                                    const settings = JSON.parse(data);
                                    settings.forEach((s: NodeSetting) => {
                                        const node = this.findNodeByPath(s.node);
                                        if (node) {
                                            node.expanded = s.expanded || false;
                                            node.format = s.format;
                                        }
                                    });
                                    this._onDidChangeTreeData.fire();
                                }
                            }, (error) => {

                            });
                            this._onDidChangeTreeData.fire();
                            resolve();
                            reporting.sendEvent('Peripheral View', 'Used', svdfile);
                        },
                        (e) => {
                            this.peripherials = [];
                            this.loaded = false;
                            this._onDidChangeTreeData.fire();
                            vscode.window.showErrorMessage(`Unable to parse SVD file: ${e.toString()}`);
                            resolve();
                            reporting.sendEvent('Peripheral View', 'Error', e.toString());
                        }
                    );
                }, 150);
            }
            else {
                resolve();
                reporting.sendEvent('Peripheral View', 'No SVD');
            }
        });
    }

    public debugSessionTerminated(): Thenable<any> {
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const fspath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, '.vscode', '.cortex-debug.peripherals.state.json');
            this.saveState(fspath);
        }
        
        this.peripherials = [];
        this.loaded = false;
        this._onDidChangeTreeData.fire();
        return Promise.resolve(true);
    }

    public debugStopped() {
        if (this.loaded) {
            const promises = this.peripherials.map((p) => p.updateData());
            Promise.all(promises).then((_) => { this._onDidChangeTreeData.fire(); }, (_) => { this._onDidChangeTreeData.fire(); });
        }
    }

    public debugContinued() {
        
    }
}
