"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = __importStar(require("vscode"));
// 设置视图提供者
class SettingsViewProvider {
    _extensionUri;
    static viewType = 'settingView';
    _view;
    constructor(_extensionUri) {
        this._extensionUri = _extensionUri;
    }
    resolveWebviewView(webviewView, context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            // 允许脚本
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        // 处理来自WebView的消息
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'saveSettings': {
                    // 保存所有设置
                    const config = vscode.workspace.getConfiguration('svala');
                    if (data.cursorWorkspacePath !== undefined) {
                        await config.update('cursorWorkspacePath', data.cursorWorkspacePath, vscode.ConfigurationTarget.Global);
                    }
                    if (data.apiKey !== undefined) {
                        await config.update('apiKey', data.apiKey, vscode.ConfigurationTarget.Global);
                    }
                    if (data.aiModel !== undefined) {
                        await config.update('aiModel', data.aiModel, vscode.ConfigurationTarget.Global);
                    }
                    vscode.window.showInformationMessage('设置已保存');
                    break;
                }
                case 'selectFolder': {
                    // 打开文件夹选择对话框
                    const folderUri = await vscode.window.showOpenDialog({
                        canSelectFiles: false,
                        canSelectFolders: true,
                        canSelectMany: false,
                        openLabel: '选择 Cursor 工作区文件夹',
                        title: '选择 Cursor 工作区路径'
                    });
                    if (folderUri && folderUri.length > 0) {
                        // 获取文件夹路径
                        const folderPath = folderUri[0].fsPath;
                        // 发送回WebView
                        this._view?.webview.postMessage({
                            type: 'folderSelected',
                            value: folderPath
                        });
                    }
                    break;
                }
            }
        });
        // 当设置变化时，更新WebView
        this._updateSettings();
    }
    async _updateSettings() {
        if (!this._view) {
            return;
        }
        const config = vscode.workspace.getConfiguration('svala');
        const cursorWorkspacePath = config.get('cursorWorkspacePath', '');
        const apiKey = config.get('apiKey', '');
        const aiModel = config.get('aiModel', 'gpt-3.5-turbo');
        this._view.webview.postMessage({
            type: 'updateSettings',
            cursorWorkspacePath,
            apiKey,
            aiModel
        });
    }
    _getHtmlForWebview(webview) {
        // 获取当前设置
        const config = vscode.workspace.getConfiguration('svala');
        const cursorWorkspacePath = config.get('cursorWorkspacePath', '');
        const apiKey = config.get('apiKey', '');
        const aiModel = config.get('aiModel', 'gpt-3.5-turbo');
        // 为各个模型生成选中状态
        const gpt35Selected = aiModel === 'gpt-3.5-turbo' ? 'selected' : '';
        const gpt4Selected = aiModel === 'gpt-4' ? 'selected' : '';
        const claudeOpusSelected = aiModel === 'claude-3-opus' ? 'selected' : '';
        const claudeSonnetSelected = aiModel === 'claude-3-sonnet' ? 'selected' : '';
        return `<!DOCTYPE html>
		<html lang="zh-CN">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>Svala 设置</title>
			<style>
				body {
					font-family: var(--vscode-font-family);
					color: var(--vscode-foreground);
					padding: 10px;
				}
				.settings-form {
					display: flex;
					flex-direction: column;
					gap: 16px;
				}
				.form-group {
					display: flex;
					flex-direction: column;
					gap: 6px;
				}
				label {
					font-weight: bold;
				}
				input, select {
					background: var(--vscode-input-background);
					color: var(--vscode-input-foreground);
					border: 1px solid var(--vscode-input-border);
					padding: 6px 8px;
					border-radius: 2px;
				}
				input:focus, select:focus {
					outline: 1px solid var(--vscode-focusBorder);
				}
				.folder-input-group {
					display: flex;
					gap: 5px;
				}
				.folder-input-group input {
					flex: 1;
				}
				button {
					background: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
					border: none;
					padding: 6px 14px;
					border-radius: 2px;
					cursor: pointer;
					font-weight: 500;
				}
				button:hover {
					background: var(--vscode-button-hoverBackground);
				}
				.save-button {
					align-self: flex-end;
					margin-top: 10px;
				}
			</style>
		</head>
		<body>
			<form class="settings-form">
				<div class="form-group">
					<label for="cursorWorkspacePath">Cursor Workspace Path</label>
					<div class="folder-input-group">
						<input type="text" id="cursorWorkspacePath" value="${cursorWorkspacePath}" />
						<button type="button" id="selectFolderBtn">浏览...</button>
					</div>
				</div>
				
				<div class="form-group">
					<label for="apiKey">API Key</label>
					<input type="text" id="apiKey" value="${apiKey}" />
				</div>
				
				<div class="form-group">
					<label for="aiModel">AI 模型</label>
					<select id="aiModel">
						<option value="gpt-3.5-turbo" ${gpt35Selected}>gpt-3.5-turbo</option>
						<option value="gpt-4" ${gpt4Selected}>gpt-4</option>
						<option value="claude-3-opus" ${claudeOpusSelected}>claude-3-opus</option>
						<option value="claude-3-sonnet" ${claudeSonnetSelected}>claude-3-sonnet</option>
					</select>
				</div>
				
				<button type="button" id="saveBtn" class="save-button">保存</button>
			</form>

			<script>
				(function() {
					// 获取元素
					const vscode = acquireVsCodeApi();
					const cursorWorkspacePathInput = document.getElementById('cursorWorkspacePath');
					const apiKeyInput = document.getElementById('apiKey');
					const aiModelSelect = document.getElementById('aiModel');
					const saveBtn = document.getElementById('saveBtn');
					const selectFolderBtn = document.getElementById('selectFolderBtn');
					
					// 保存按钮点击事件
					saveBtn.addEventListener('click', () => {
						vscode.postMessage({
							type: 'saveSettings',
							cursorWorkspacePath: cursorWorkspacePathInput.value,
							apiKey: apiKeyInput.value,
							aiModel: aiModelSelect.value
						});
					});
					
					// 选择文件夹按钮点击事件
					selectFolderBtn.addEventListener('click', () => {
						vscode.postMessage({
							type: 'selectFolder'
						});
					});
					
					// 监听来自扩展的消息
					window.addEventListener('message', event => {
						const message = event.data;
						
						switch (message.type) {
							case 'updateSettings':
								// 更新界面上的值
								cursorWorkspacePathInput.value = message.cursorWorkspacePath;
								apiKeyInput.value = message.apiKey;
								aiModelSelect.value = message.aiModel;
								break;
								
							case 'folderSelected':
								// 更新路径输入框的值
								cursorWorkspacePathInput.value = message.value;
								break;
						}
					});
				}())
			</script>
		</body>
		</html>`;
    }
}
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
function activate(context) {
    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "svala" is now active!');
    // 注册设置视图提供者
    const settingsViewProvider = new SettingsViewProvider(context.extensionUri);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(SettingsViewProvider.viewType, settingsViewProvider));
    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json
    const disposable = vscode.commands.registerCommand('svala.analyze', () => {
        // The code you place here will be executed every time your command is executed
        // Display a message box to the user
        vscode.window.showInformationMessage('Hello VS Code');
    });
    const setting = vscode.commands.registerCommand('svala.setting', () => {
        // 显示/聚焦设置视图
        vscode.commands.executeCommand('workbench.view.extension.svala');
        vscode.commands.executeCommand('workbench.view.extension.svala-settingView.focus');
    });
    // 添加选择工作区路径命令
    const selectWorkspacePath = vscode.commands.registerCommand('svala.selectWorkspacePath', async () => {
        // 弹出文件夹选择对话框
        const folderUri = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: '选择 Cursor 工作区文件夹',
            title: '选择 Cursor 工作区路径'
        });
        // 如果用户选择了文件夹
        if (folderUri && folderUri.length > 0) {
            // 获取文件夹路径
            const folderPath = folderUri[0].fsPath;
            // 更新配置
            await vscode.workspace.getConfiguration('svala').update('cursorWorkspacePath', folderPath, vscode.ConfigurationTarget.Global);
            // 显示成功消息
            vscode.window.showInformationMessage(`已设置 Cursor 工作区路径: ${folderPath}`);
        }
    });
    context.subscriptions.push(disposable);
    context.subscriptions.push(setting);
    context.subscriptions.push(selectWorkspacePath);
}
// This method is called when your extension is deactivated
function deactivate() { }
//# sourceMappingURL=extension.js.map