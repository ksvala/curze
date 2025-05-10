// 添加全局变量用于跟踪聊天记录面板
let chatHistoryPanel: vscode.WebviewPanel | undefined;

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// 导入 sqlite3 用于读取数据库
// 使用 @vscode/sqlite3 依赖
const sqlite3 = require('@vscode/sqlite3');
import { promisify } from 'util';
import * as marked from 'marked';

// 定义聊天记录数据结构
interface MainRecord {
    composerId: string;
    title?: string;
    createdAt?: number;
    fullConversationHeadersOnly?: BubbleHeader[];
    folder?: string;
}

interface BubbleHeader {
    bubbleId: string;
}

interface BubbleRecord {
    bubbleId: string;
    role: 'user' | 'assistant' | 'ai';
    content: string;
    createdAt: number;
}

// 定义对话引用数据结构
interface ComposerRef {
    composerId: string;
    title?: string;
    createdAt?: number;
    folder?: string;
}

// 定义数据库查询结果的接口
interface DBRow {
    key: string;
    value: string;
}

// 定义常量
const DB_TABLES = {
    WORKSPACE: 'ItemTable',
    GLOBAL_METADATA: 'ItemTable',
    GLOBAL_BUBBLES: 'cursorDiskKV'
};

const DB_KEYS = {
    COMPOSER_DATA: 'composer.composerData',
    COMPOSER_METADATA_PREFIX: 'composerData:',
    BUBBLE_PREFIX: 'bubbleId:'
};

// ==================== 数据访问层 ====================

/**
 * Promise 化的数据库查询（单行）
 * @param db 数据库连接
 * @param sql SQL查询语句
 * @param params 查询参数
 * @returns 查询结果（单行）
 */
function dbGet(db: any, sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err: Error | null, row: any) => {
            if (err) {
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}

/**
 * Promise 化的数据库查询（多行）
 * @param db 数据库连接
 * @param sql SQL查询语句
 * @param params 查询参数
 * @returns 查询结果（多行）
 */
function dbAll(db: any, sql: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err: Error | null, rows: any[]) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

/**
 * 从工作区数据库中获取所有对话引用
 * @param workspaceDbPath 工作区数据库路径
 * @returns 对话引用列表
 */
async function getAllComposersFromWorkspaceDb(workspaceDbPath: string): Promise<ComposerRef[]> {
    // 连接数据库
    const db = new sqlite3.Database(workspaceDbPath, sqlite3.OPEN_READONLY);
    
    try {
        console.log(`尝试从工作区数据库获取对话引用: ${workspaceDbPath}`);
        
        // 查询 ItemTable 表中的 composer.composerData 记录
        const row = await dbGet(db, `SELECT value FROM ${DB_TABLES.WORKSPACE} WHERE key = ?`, [DB_KEYS.COMPOSER_DATA]);
        
        if (!row || !row.value) {
            console.log('没有找到 composer.composerData 记录');
            return [];
        }
        
        // 解析 JSON 数据，提取 allComposers 字段
        const composerData = JSON.parse(row.value);
        if (!composerData || !composerData.allComposers) {
            console.log('composer.composerData 中没有 allComposers 字段');
            return [];
        }
        
        const composers = composerData.allComposers;
        console.log('composers',composers);
        
        // 提取所有 composerId 和相关信息
        const composerRefs: ComposerRef[] = composers.map((composer: any) => ({
            composerId: composer.composerId,
            title: composer.name || `对话 ${composer.composerId ? composer.composerId.substring(0, 8) : '未知'}`,
            createdAt: composer.createdAt,
            folder: composer.folder
        }));
        
        return composerRefs;
    } catch (error) {
        console.error('获取对话引用失败:', error);
        throw new Error(`获取对话引用失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
        db.close();
    }
}

/**
 * 从全局存储中获取对话元数据
 * @param globalDbPath 全局存储数据库路径
 * @param composerId 对话ID
 * @returns 对话元数据或null
 */
async function getMainRecordFromGlobalDb(globalDbPath: string, composerId: string): Promise<MainRecord | null> {
    // 连接数据库
    const db = new sqlite3.Database(globalDbPath, sqlite3.OPEN_READONLY);
    
    try {
        console.log(`尝试从全局存储获取对话元数据 (composerId: ${composerId})`);
        
        // 查询 ItemTable 表中的对话元数据
        const key = `${DB_KEYS.COMPOSER_METADATA_PREFIX}${composerId}`;
        const row = await dbGet(db, `SELECT value FROM ${DB_TABLES.GLOBAL_BUBBLES} WHERE key = ?`, [key]);
        
        if (!row || !row.value) {
            console.log(`未找到对话元数据 (composerId: ${composerId})`);
            return null;
        }
        
        // 解析 JSON 数据
        const mainRecord = JSON.parse(row.value);
        return {
            composerId: composerId,
            title: mainRecord.title,
            createdAt: mainRecord.createdAt,
            fullConversationHeadersOnly: mainRecord.fullConversationHeadersOnly || [],
            folder: mainRecord.folder
        };
    } catch (error) {
        console.error(`获取对话元数据失败 (composerId: ${composerId}):`, error);
        throw new Error(`获取对话元数据失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
        db.close();
    }
}

/**
 * 从全局存储中获取对话的所有气泡内容
 * @param globalDbPath 全局存储数据库路径
 * @param composerId 对话ID
 * @returns 气泡记录数组
 */
async function getBubblesFromGlobalDb(globalDbPath: string, composerId: string): Promise<BubbleRecord[]> {
    // 连接数据库
    const db = new sqlite3.Database(globalDbPath, sqlite3.OPEN_READONLY);
    
    try {
        console.log(`尝试从全局存储获取气泡内容 (composerId: ${composerId})`);
        
        // 查询 cursorDiskKV 表中的所有气泡记录
        const keyPattern = `${DB_KEYS.BUBBLE_PREFIX}${composerId}:%`;
        const rows = await dbAll(db, `SELECT key, value FROM ${DB_TABLES.GLOBAL_BUBBLES} WHERE value IS NOT NULL AND value != '' AND key LIKE ?`, [keyPattern]);
        
        if (!rows || rows.length === 0) {
            console.log(`未找到气泡记录 (composerId: ${composerId})`);
            return [];
        }
        
        console.log(`找到 ${rows.length} 条气泡记录`);
        
        // 解析所有气泡记录
        const bubbles: BubbleRecord[] = [];
        for (const row of rows) {
            try {
                if (!row.value) {
                    console.warn(`气泡记录值为空: ${row.key}`);
                    continue;
                }
                
                const parts = row.key.split(':');
                if (parts.length < 3) {
                    console.warn(`气泡记录键格式不正确: ${row.key}`);
                    continue;
                }
                
                const bubbleId = parts[2];
                const bubbleData = JSON.parse(row.value);
                if(bubbleData.text) {
                bubbles.push({
                    bubbleId: bubbleId,
						role: bubbleData.type === 1 ? 'user' : 'assistant',
                    content: bubbleData.text || '',
                    createdAt: bubbleData.createdAt || 0
                });
				}
            } catch (parseError) {
                console.warn(`解析气泡记录失败: ${row.key}`, parseError);
                // 继续处理下一条记录
            }
        }
        
        // 按创建时间排序
        return bubbles.sort((a, b) => a.createdAt - b.createdAt);
    } catch (error) {
        console.error(`获取气泡内容失败 (composerId: ${composerId}):`, error);
        throw new Error(`获取气泡内容失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
        db.close();
    }
}

// 辅助函数：检查文件是否是有效的 Cursor 数据库
async function isCursorDatabase(filePath: string): Promise<boolean> {
    return new Promise((resolve) => {
        try {
            console.log(`检查文件是否是 Cursor 数据库: ${filePath}`);
            
            // 尝试打开数据库
            const db = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, (err: Error | null) => {
                if (err) {
                    console.log(`打开数据库失败: ${err.message}`);
                    resolve(false);
                    return;
                }
                
                // 检查表结构
                db.all("SELECT name FROM sqlite_master WHERE type='table'", (tableErr: Error | null, tables: {name: string}[]) => {
                    if (tableErr) {
                        console.log(`查询表结构失败: ${tableErr.message}`);
                        db.close();
                        resolve(false);
                        return;
                    }
                    
                    const tableNames = tables.map(t => t.name);
                    console.log(`数据库中的表: ${tableNames.join(', ')}`);
                    
                    // 如果存在 ItemTable 或 items 表，进一步检查内容
                    const tableName = tableNames.includes('ItemTable') ? 'ItemTable' : 
                                    tableNames.includes('items') ? 'items' : null;
                    
                    if (!tableName) {
                        console.log('数据库中没有找到 ItemTable 或 items 表');
                        db.close();
                        resolve(false);
                        return;
                    }
                    
                    // 查询是否存在 composerData 开头的记录
                    db.get(`SELECT COUNT(*) as count FROM ${tableName} WHERE key LIKE 'composerData:%' LIMIT 1`, (countErr: Error | null, result: {count: number}) => {
                        if (countErr) {
                            console.log(`查询 composerData 记录失败: ${countErr.message}`);
                            db.close();
                            resolve(false);
                            return;
                        }
                        
                        const hasComposerData = result.count > 0;
                        console.log(`数据库中${hasComposerData ? '存在' : '不存在'} composerData 记录`);
                        
                        db.close();
                        resolve(hasComposerData);
                    });
                });
            });
        } catch (error) {
            console.error(`检查数据库出错: ${error}`);
            resolve(false);
        }
    });
}

// 辅助函数：深度递归搜索 Cursor 数据库文件
async function findCursorDatabase(dirPath: string, maxDepth: number = 5): Promise<string | null> {
    console.log(`在目录中搜索 Cursor 数据库: ${dirPath}，最大深度: ${maxDepth}`);
    
    const search = async (dir: string, depth: number = 0): Promise<string | null> => {
        if (depth > maxDepth) {
            return null;
        }
        
        try {
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            
            // 首先检查当前目录中的 state.vscdb 文件
            const stateDbEntry = entries.find(entry => entry.isFile() && entry.name === 'state.vscdb');
            if (stateDbEntry) {
                const dbPath = path.join(dir, 'state.vscdb');
                console.log(`找到数据库文件: ${dbPath}`);
                
                // 验证这是一个 Cursor 数据库
                if (await isCursorDatabase(dbPath)) {
                    console.log(`确认是有效的 Cursor 数据库: ${dbPath}`);
                    return dbPath;
                }
                console.log(`不是 Cursor 数据库，继续搜索...`);
            }
            
            // 递归搜索子目录
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const subDir = path.join(dir, entry.name);
                    const result = await search(subDir, depth + 1);
                    if (result) {
                        return result;
                    }
                }
            }
            
            return null;
        } catch (error) {
            console.log(`读取目录 ${dir} 时出错: ${error}`);
            return null;
        }
    };
    
    return search(dirPath);
}

// 主视图提供者 - 可切换列表和设置模式
class MainViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'mychangeImg';

	private _view?: vscode.WebviewView;
	private _currentMode: 'list' | 'setting' = 'list'; // 默认显示列表模式

	constructor(
		private readonly _extensionUri: vscode.Uri,
	) { }

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		try {
			console.log('=== resolveWebviewView 被调用 ===');
			console.log('webviewView.viewType:', webviewView.viewType);
			console.log('MainViewProvider.viewType:', MainViewProvider.viewType);
			this._view = webviewView;

			webviewView.webview.options = {
				// 允许脚本
				enableScripts: true,
				localResourceRoots: [
					this._extensionUri
				]
			};

			// 初始化Webview内容
			this._updateWebviewContent();
			console.log('WebView内容已更新');

			// 存储当前设置，用于webviewReady消息处理
			const config = vscode.workspace.getConfiguration('svala');
			const currentSettings = {
				cursorWorkspacePath: config.get('cursorWorkspacePath', '') as string,
				apiKey: config.get('apiKey', '') as string,
				aiModel: config.get('aiModel', 'gpt-3.5-turbo') as string
			};

			// 处理来自WebView的消息
			webviewView.webview.onDidReceiveMessage(async data => {
				switch (data.type) {
					case 'webviewReady': {
						// WebView已准备好，发送当前设置
						console.log('WebView报告已就绪，发送当前设置');
						this.updateSettings(); // 使用我们新增的方法发送最新设置
						break;
					}
					
					case 'saveSettings': {
						// 保存所有设置
						const config = vscode.workspace.getConfiguration('svala');
						if (data.cursorWorkspacePath !== undefined) {
							await config.update('cursorWorkspacePath', data.cursorWorkspacePath, vscode.ConfigurationTarget.Global);
						}
						if (data.apiProvider !== undefined) {
							await config.update('apiProvider', data.apiProvider, vscode.ConfigurationTarget.Global);
						}
						if (data.apiBaseUrl !== undefined) {
							await config.update('apiBaseUrl', data.apiBaseUrl, vscode.ConfigurationTarget.Global);
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
						console.log('处理selectFolder消息，准备打开文件选择对话框');
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
							console.log('用户已选择文件夹:', folderPath);
							
							// 验证选择的是否为Cursor目录
							const folderName = path.basename(folderPath);
							if (folderName.toLowerCase() !== 'cursor') {
								console.log('选择的不是Cursor目录');
								vscode.window.showErrorMessage('请选择Cursor目录，而不是其他目录');
								return;
							}
							
							// 验证是否包含workspaceStorage子目录
							const workspaceStoragePath = path.join(folderPath, 'User', 'workspaceStorage');
							if (!fs.existsSync(workspaceStoragePath)) {
								console.log('选择的Cursor目录下没有找到User/workspaceStorage路径');
								vscode.window.showErrorMessage('选择的不是有效的Cursor目录，请确保包含User/workspaceStorage路径');
								return;
							}
							
							// 使用workspaceStorage路径而不是Cursor根目录
							const validPath = workspaceStoragePath;
							console.log('验证通过，使用路径:', validPath);
							
							// 发送回WebView
							if (this._view) {
								console.log('正在发送folderSelected消息到WebView');
								try {
									// 确保视图仍然存在
									this._view.webview.postMessage({ 
										type: 'folderSelected', 
										value: validPath 
									});
									console.log('folderSelected消息已发送');
									
									// 为确保消息被处理，我们增加一个延迟后再发送一次
									setTimeout(() => {
										if (this._view) {
											console.log('发送延迟的folderSelected消息');
											this._view.webview.postMessage({ 
												type: 'folderSelected', 
												value: validPath 
											});
										}
									}, 500);
									
									// 同时更新设置
									const config = vscode.workspace.getConfiguration('svala');
									await config.update('cursorWorkspacePath', validPath, vscode.ConfigurationTarget.Global);
									
								} catch (error) {
									console.error('发送folderSelected消息失败:', error);
								}
							} else {
								console.error('_view未定义，无法发送消息');
							}
						} else {
							console.log('用户取消了文件夹选择');
						}
						break;
					}
					case 'switchToList': {
						// 切换到列表视图
						this.switchToListMode();
						break;
					}
					case 'switchToSettings': {
						// 切换到设置视图
						this.switchToSettingMode();
						break;
					}
					case 'getWorkspaceTree': {
						// 获取工作区目录树数据
						const config = vscode.workspace.getConfiguration('svala');
						const cursorWorkspacePath = config.get('cursorWorkspacePath', '') as string;
						
						try {
							if (!cursorWorkspacePath) {
								throw new Error('未设置 Cursor Workspace 路径，请先在设置中配置路径。');
							}
							
							const treeData = await this.getWorkspaceTreeData(cursorWorkspacePath);
							
							if (this._view) {
								this._view.webview.postMessage({ 
									type: 'workspaceTree', 
									data: treeData 
								});
							}
						} catch (error) {
							console.error('获取工作区目录树失败:', error);
							if (this._view) {
								this._view.webview.postMessage({ 
									type: 'workspaceTreeError', 
									message: error instanceof Error ? error.message : '获取工作区目录树失败'
								});
							}
						}
						break;
					}
					case 'openWorkspaceFile': {
						// 打开工作区文件
						console.log('处理openWorkspaceFile消息，准备在文件管理器中打开工作区文件夹');
						const config = vscode.workspace.getConfiguration('svala');
						const cursorWorkspacePath = config.get('cursorWorkspacePath', '') as string;
						
						try {
							if (!cursorWorkspacePath) {
								throw new Error('未设置 Cursor Workspace 路径');
							}
							
							if (!data.hash) {
								throw new Error('未提供有效的工作区 hash');
							}
							
							// 构建目录路径（不再打开workspace.json文件，而是打开目录）
							const folderPath = path.resolve(cursorWorkspacePath, data.hash);
							
							// 检查目录是否存在
							if (!fs.existsSync(folderPath)) {
								throw new Error(`目录不存在: ${folderPath}`);
							}
							
							// 在文件管理器中打开文件夹（而不是在VSCode中打开）
							const uri = vscode.Uri.file(folderPath);
							await vscode.commands.executeCommand('revealFileInOS', uri);
							
							console.log(`已在文件管理器中打开目录: ${folderPath}`);
						} catch (error) {
							console.error('打开工作区文件夹失败:', error);
							vscode.window.showErrorMessage(`打开工作区文件夹失败: ${error instanceof Error ? error.message : '未知错误'}`);
						}
						break;
					}
					case 'openFolder': {
						// 打开目录
						console.log('处理openFolder消息，准备打开目录');
						
						try {
							if (!data.folder) {
								throw new Error('未提供有效的目录路径');
							}
							
							let folderPath = data.folder;
							
							// 处理 file:// 前缀
							if (typeof folderPath === 'string' && folderPath.startsWith('file://')) {
								folderPath = folderPath.replace('file://', '');
							}
							
							// 标准化路径（解析相对路径、正斜杠等）
							folderPath = path.resolve(folderPath);
							
							console.log(`尝试打开目录: ${folderPath}`);
							
							// 检查目录是否存在
							if (!fs.existsSync(folderPath)) {
								console.log(`目录不存在: ${folderPath}`);
								throw new Error(`目录不存在: ${folderPath}`);
							}
							
							// 打开目录
							const uri = vscode.Uri.file(folderPath);
							await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
							
							console.log(`已在新窗口打开目录: ${folderPath}`);
						} catch (error) {
							console.error('打开目录失败:', error);
							vscode.window.showErrorMessage(`打开目录失败: ${error instanceof Error ? error.message : '未知错误'}`);
						}
						break;
					}
					case 'exportRecords': {
						try {
							// 1. 获取 Cursor 工作区路径
							const config = vscode.workspace.getConfiguration('svala');
							const cursorWorkspacePath = config.get('cursorWorkspacePath', '') as string;
							if (!cursorWorkspacePath) throw new Error('未设置 Cursor Workspace 路径');

							// 2. 获取全局存储数据库路径
							const globalDbPath = getCursorGlobalStoragePath();
							if (!globalDbPath) throw new Error('未找到 Cursor 全局存储数据库');

							// 3. 只遍历用户勾选的 hash
							if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
								throw new Error('请至少勾选一个工作区');
							}

							const allConversations = [];
							for (const item of data.items) {
								const hash = item.hash;
								const hashFolderPath = path.join(cursorWorkspacePath, hash);
								const workspaceDbPath = findWorkspaceDb(hashFolderPath);
								if (!workspaceDbPath) continue;
								const composers = await getAllComposersFromWorkspaceDb(workspaceDbPath);
								for (const composer of composers) {
									const bubbles = await getBubblesFromGlobalDb(globalDbPath, composer.composerId);
									allConversations.push({
										composer_id: composer.composerId,
										composer_name: composer.title || '',
										history: bubbles.map(b => ({
											role: b.role,
											content: b.content,
											createdAt: b.createdAt
										}))
									});
								}
							}

							// 4. 生成日期+随机字符串的文件名
							function getRandomStr(len = 6) {
								return Math.random().toString(36).substr(2, len);
							}
							function getDateStr() {
								const d = new Date();
								const pad = (n: number) => n.toString().padStart(2, '0');
								return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
							}
							const fileName = `${getDateStr()}_${getRandomStr(6)}.json`;

							// 5. 弹出保存对话框，导出为 JSON 文件
							const os = require('os');
							const pathModule = require('path');
							const defaultPath = pathModule.join(os.homedir(), 'Documents', fileName);
							const fileUri = await vscode.window.showSaveDialog({
								defaultUri: vscode.Uri.file(defaultPath),
								filters: { 'JSON文件': ['json'], '所有文件': ['*'] },
								title: '导出选中工作区的聊天记录'
							});
								if (fileUri) {
								fs.writeFile(fileUri.fsPath, JSON.stringify(allConversations, null, 2), 'utf8', err => {
										if (err) {
											vscode.window.showErrorMessage(`导出文件失败: ${err.message}`);
										} else {
										vscode.window.showInformationMessage(`已成功导出选中工作区的聊天记录到 ${fileUri.fsPath}`);
										}
									});
								}
						} catch (error) {
							vscode.window.showErrorMessage(`导出选中聊天记录失败: ${error instanceof Error ? error.message : '未知错误'}`);
						}
						break;
					}
					case 'openSecondarySidebar': {
						// 打开辅助侧边栏显示聊天记录
						console.log('处理openSecondarySidebar消息，准备打开聊天记录');
						
						try {
							if (!data.hash) {
								throw new Error('未提供有效的工作区 hash');
							}
							
							const hash = data.hash;
							console.log(`准备查看 hash: ${hash} 的聊天记录`);
							
							// 获取聊天记录
							const config = vscode.workspace.getConfiguration('svala');
							const cursorWorkspacePath = config.get('cursorWorkspacePath', '') as string;
							
							if (!cursorWorkspacePath) {
								throw new Error('未设置 Cursor Workspace 路径');
							}
							
							// 构建目录路径 - 需要找到正确的 Cursor 聊天记录数据库路径
							const hashFolderPath = path.resolve(cursorWorkspacePath, hash);
							
							// 检查原始路径是否存在
							if (!fs.existsSync(hashFolderPath)) {
								throw new Error(`Hash 目录不存在: ${hashFolderPath}`);
							}
							
							// 获取全局存储数据库路径，用于读取详细聊天记录
							const globalDbPath = getCursorGlobalStoragePath();
							if (!globalDbPath) {
								throw new Error(`未找到 Cursor 全局存储数据库，无法获取聊天记录详情`);
							}
							
							// 尝试列出 hash 目录下的所有文件，以便调试
							const filesInHashFolder = fs.readdirSync(hashFolderPath);
							
							// 确定工作区数据库文件路径，用于获取对话ID
							let workspaceDbPath = '';
							
							// 方案1: 直接在 hash 目录下找 state.vscdb
							const directDbPath = path.join(hashFolderPath, 'state.vscdb');
							if (fs.existsSync(directDbPath)) {
								workspaceDbPath = directDbPath;
							}
							
							// 方案2: 如果是工作区目录，找下面的 .cursor 或 .vscode 目录
							const cursorFolderPath = path.join(hashFolderPath, '.cursor');
							if (fs.existsSync(cursorFolderPath)) {
								const cursorDbPath = path.join(cursorFolderPath, 'state.vscdb');
								if (fs.existsSync(cursorDbPath)) {
									workspaceDbPath = cursorDbPath;
								}
							}
							
							// 方案3: 检查 .vscode 目录
							const vscodeFolderPath = path.join(hashFolderPath, '.vscode');
							if (fs.existsSync(vscodeFolderPath)) {
								const vscodeDbPath = path.join(vscodeFolderPath, 'state.vscdb');
								if (fs.existsSync(vscodeDbPath)) {
									workspaceDbPath = vscodeDbPath;
								}
							}
							
							// 如果没找到数据库文件，尝试深度搜索
							if (!workspaceDbPath) {
								// 递归搜索前3层子目录
								const searchDbInDir = (dir: string, depth: number = 0): string | null => {
									if (depth > 3) return null;
									
									try {
										const files = fs.readdirSync(dir);
										
										// 先检查当前目录
										if (files.includes('state.vscdb')) {
											return path.join(dir, 'state.vscdb');
										}
										
										// 然后检查子目录
										for (const file of files) {
											const fullPath = path.join(dir, file);
											try {
												if (fs.statSync(fullPath).isDirectory()) {
													const result = searchDbInDir(fullPath, depth + 1);
													if (result) return result;
												}
											} catch (e) {
												// 忽略权限错误等
											}
										}
									} catch (e) {
										// 忽略目录读取错误
									}
									
									return null;
								};
								
								const foundDbPath = searchDbInDir(hashFolderPath);
								if (foundDbPath) {
									workspaceDbPath = foundDbPath;
								}
							}
							
							// 如果仍然没找到工作区数据库，报错
							if (!workspaceDbPath) {
								throw new Error(`在 hash 目录下未找到 state.vscdb 数据库文件`);
							}
							
							// 检查是否已经有打开的聊天记录面板
							if (chatHistoryPanel) {
								// 更新标题和内容
								chatHistoryPanel.title = `聊天记录 - ${hash.substring(0, 8)}...`;
								
								// 异步获取HTML内容 - 使用全局存储数据库获取详细聊天记录
								this._getChatHistoryHtml(hash, hashFolderPath, globalDbPath).then(html => {
									if (chatHistoryPanel) {
										chatHistoryPanel.webview.html = html;
									}
								}).catch(error => {
									console.error('获取聊天记录HTML失败:', error);
									if (chatHistoryPanel) {
										chatHistoryPanel.webview.html = this._getErrorHtml(error instanceof Error ? error.message : '获取聊天记录时发生未知错误');
									}
								});
								
								// 让面板保持可见
								chatHistoryPanel.reveal();
							} else {
								// 创建并显示 Secondary Sidebar 的 Webview Panel
								chatHistoryPanel = vscode.window.createWebviewPanel(
									'chatHistory', // 标识符
									`聊天记录 - ${hash.substring(0, 8)}...`, // 标题
									vscode.ViewColumn.Beside, // 在编辑器旁边显示
									{
										enableScripts: true,
										retainContextWhenHidden: true
									}
								);
								
								// 先显示加载中
								chatHistoryPanel.webview.html = `<!DOCTYPE html>
								<html lang="zh-CN">
								<head>
									<meta charset="UTF-8">
									<meta name="viewport" content="width=device-width, initial-scale=1.0">
									<style>
										body {
											font-family: var(--vscode-font-family);
											display: flex;
											justify-content: center;
											align-items: center;
											height: 100vh;
											margin: 0;
										}
										.loading {
											display: flex;
											flex-direction: column;
											align-items: center;
										}
										.spinner {
											width: 40px;
											height: 40px;
											border: 4px solid var(--vscode-button-background, #0e639c);
											border-top-color: transparent;
											border-radius: 50%;
											animation: spin 1s linear infinite;
											margin-bottom: 16px;
										}
										@keyframes spin {
											0% { transform: rotate(0deg); }
											100% { transform: rotate(360deg); }
										}
									</style>
								</head>
								<body>
									<div class="loading">
										<div class="spinner"></div>
										<div>正在加载聊天记录...</div>
									</div>
								</body>
								</html>`;
								
								// 异步获取HTML内容 - 使用全局存储数据库获取详细聊天记录
								this._getChatHistoryHtml(hash, hashFolderPath, globalDbPath).then(html => {
									if (chatHistoryPanel) {
										chatHistoryPanel.webview.html = html;
									}
								}).catch(error => {
									console.error('获取聊天记录HTML失败:', error);
									if (chatHistoryPanel) {
										chatHistoryPanel.webview.html = this._getErrorHtml(error instanceof Error ? error.message : '获取聊天记录时发生未知错误');
									}
								});
								
								// 新增：为每次新建的 chatHistoryPanel 注入消息监听脚本
								chatHistoryPanel.webview.onDidReceiveMessage((message) => {
									// 这里可以根据需要处理来自 webview 的消息
									// 例如：
									if (message && message.type === 'getChatContent') {
										(async () => {
											try {
												const config = vscode.workspace.getConfiguration('svala');
												const cursorWorkspacePath = config.get('cursorWorkspacePath', '') as string;
												const hashFolderPath = path.join(cursorWorkspacePath, message.hash);
												const globalStoragePath = getCursorGlobalStoragePath();
												const workspaceDbPath = findWorkspaceDb(hashFolderPath);
												if (!workspaceDbPath || !globalStoragePath) throw new Error('找不到数据库');
												const { mainRecord, bubbles } = await getFullConversation(workspaceDbPath, globalStoragePath, message.hash, message.composerId);
												if (chatHistoryPanel) {
													chatHistoryPanel.webview.postMessage({
														type: 'chatContent',
														mainRecord,
														bubbles
													});
												}
											} catch (e) {
												if (chatHistoryPanel) {
													chatHistoryPanel.webview.postMessage({
														type: 'chatContentError',
														message: e instanceof Error ? e.message : String(e)
													});
												}
											}
										})();
									}
								});
								
								// 监听面板关闭事件，清除引用
								chatHistoryPanel.onDidDispose(() => {
									chatHistoryPanel = undefined;
								});
							}
							
						} catch (error) {
							console.error('打开聊天记录失败:', error);
							vscode.window.showErrorMessage(`打开聊天记录失败: ${error instanceof Error ? error.message : '未知错误'}`);
							
							// 如果有错误且面板已经存在，显示错误信息
							if (chatHistoryPanel) {
								chatHistoryPanel.webview.html = this._getErrorHtml(error instanceof Error ? error.message : '未知错误');
							}
						}
						break;
					}
					case 'showMessage': {
						// 显示消息通知
						if (data.message) {
							vscode.window.showInformationMessage(data.message);
						}
						break;
					}
					case 'openChatHistory': {
						// 打开聊天记录详情
						const hash = data.hash;
						const folder = data.folder || '';
						const composerId = data.composerId; // 新增
						try {
							if (!hash) {
								throw new Error('缺少必要的 hash 参数');
							}
							// 获取 Cursor Workspace 配置
							const config = vscode.workspace.getConfiguration('svala');
							const cursorWorkspacePath = config.get('cursorWorkspacePath', '') as string;
							if (!cursorWorkspacePath) {
								throw new Error('未设置 Cursor Workspace 路径，请先在设置中配置路径');
							}
							// 构建 hash 文件夹路径
							const hashFolderPath = path.join(cursorWorkspacePath, hash);
							// 检查 hash 目录是否存在
							if (!fs.existsSync(hashFolderPath)) {
								throw new Error(`hash 目录不存在: ${hashFolderPath}`);
							}
							// 获取全局存储数据库路径
							const globalStoragePath = getCursorGlobalStoragePath();
							if (!globalStoragePath) {
								throw new Error(`未找到 Cursor 全局存储数据库，无法获取聊天记录详情`);
							}
							// 使用智能搜索找到工作区数据库文件，获取对话ID
							findCursorDatabase(hashFolderPath).then(workspaceDbPath => {
								if (!workspaceDbPath) {
									throw new Error(`未找到有效的 Cursor 工作区数据库文件，请检查选择的目录是否正确`);
								}
								// 检查是否已经有打开的聊天记录面板
								if (chatHistoryPanel) {
									// 更新标题和内容
									chatHistoryPanel.title = `聊天记录 - ${hash.substring(0, 8)}...`;
									// 异步获取HTML内容 - 使用全局存储数据库路径获取完整详情，支持 composerId
									this._getChatHistoryHtml(hash, hashFolderPath, globalStoragePath, composerId).then(html => {
										if (chatHistoryPanel) {
											chatHistoryPanel.webview.html = html;
										}
									}).catch(error => {
										console.error('获取聊天记录HTML失败:', error);
										if (chatHistoryPanel) {
											chatHistoryPanel.webview.html = this._getErrorHtml(error instanceof Error ? error.message : '获取聊天记录时发生未知错误');
										}
									});
									// 让面板保持可见
									chatHistoryPanel.reveal();
								} else {
									// 创建并显示 Secondary Sidebar 的 Webview Panel
									chatHistoryPanel = vscode.window.createWebviewPanel(
										'chatHistory', // 标识符
										`聊天记录 - ${hash.substring(0, 8)}...`, // 标题
										vscode.ViewColumn.Beside, // 在编辑器旁边显示
										{
											enableScripts: true,
											retainContextWhenHidden: true
										}
									);
									// 先显示加载中
									chatHistoryPanel.webview.html = `<!DOCTYPE html>
									<html lang="zh-CN">
									<head>
										<meta charset="UTF-8">
										<meta name="viewport" content="width=device-width, initial-scale=1.0">
										<style>
											body {
												font-family: var(--vscode-font-family);
												display: flex;
												justify-content: center;
												align-items: center;
												height: 100vh;
												margin: 0;
											}
											.loading {
												display: flex;
												flex-direction: column;
												align-items: center;
											}
											.spinner {
												width: 40px;
												height: 40px;
												border: 4px solid var(--vscode-button-background, #0e639c);
												border-top-color: transparent;
												border-radius: 50%;
												animation: spin 1s linear infinite;
												margin-bottom: 16px;
											}
											@keyframes spin {
												0% { transform: rotate(0deg); }
												100% { transform: rotate(360deg); }
											}
										</style>
									</head>
									<body>
										<div class="loading">
											<div class="spinner"></div>
											<div>正在加载聊天记录...</div>
										</div>
									</body>
									</html>`;
									// 异步获取HTML内容 - 使用全局存储数据库路径获取完整详情，支持 composerId
									this._getChatHistoryHtml(hash, hashFolderPath, globalStoragePath, composerId).then(html => {
										if (chatHistoryPanel) {
											chatHistoryPanel.webview.html = html;
										}
									}).catch(error => {
										console.error('获取聊天记录HTML失败:', error);
										if (chatHistoryPanel) {
											chatHistoryPanel.webview.html = this._getErrorHtml(error instanceof Error ? error.message : '获取聊天记录时发生未知错误');
										}
									});
									// 监听面板关闭事件，清除引用
									chatHistoryPanel.onDidDispose(() => {
										chatHistoryPanel = undefined;
									});
								}
							}).catch(error => {
								console.error('查找数据库失败:', error);
								vscode.window.showErrorMessage(`查找数据库失败: ${error instanceof Error ? error.message : '未知错误'}`);
								// 如果有错误且面板已经存在，显示错误信息
								if (chatHistoryPanel) {
									chatHistoryPanel.webview.html = this._getErrorHtml(error instanceof Error ? error.message : '未知错误');
								}
							});
						} catch (error) {
							console.error('打开聊天记录失败:', error);
							vscode.window.showErrorMessage(`打开聊天记录失败: ${error instanceof Error ? error.message : '未知错误'}`);
							// 如果有错误且面板已经存在，显示错误信息
							if (chatHistoryPanel) {
								chatHistoryPanel.webview.html = this._getErrorHtml(error instanceof Error ? error.message : '未知错误');
							}
						}
						break;
					}
					case 'getChatContent': {
						try {
							const config = vscode.workspace.getConfiguration('svala');
							const cursorWorkspacePath = config.get('cursorWorkspacePath', '') as string;
							const hashFolderPath = path.join(cursorWorkspacePath, data.hash);
							const globalStoragePath = getCursorGlobalStoragePath();
							const workspaceDbPath = findWorkspaceDb(hashFolderPath);
							if (!workspaceDbPath || !globalStoragePath) throw new Error('找不到数据库');
							const { mainRecord, bubbles } = await getFullConversation(workspaceDbPath, globalStoragePath, data.hash, data.composerId);
							if (chatHistoryPanel) {
								chatHistoryPanel.webview.postMessage({
									type: 'chatContent',
									mainRecord,
									bubbles
								});
							}
						} catch (e) {
							if (chatHistoryPanel) {
								chatHistoryPanel.webview.postMessage({
									type: 'chatContentError',
									message: e instanceof Error ? e.message : String(e)
								});
							}
						}
						break;
					}
				}
			});
		} catch (error) {
			console.error('resolveWebviewView 出错:', error);
			vscode.window.showErrorMessage(`视图初始化错误: ${error}`);
		}
	}

	// 获取工作区目录树数据
	private async getWorkspaceTreeData(cursorWorkspacePath: string): Promise<{ hash: string, folder: string }[]> {
		const fsPromises = fs.promises;
		const result: { hash: string, folder: string }[] = [];
		
		try {
			// 检查路径是否存在
			await fsPromises.access(cursorWorkspacePath, fs.constants.F_OK);
			
			// 读取目录内容
			const subdirs = await fsPromises.readdir(cursorWorkspacePath);
			
			// 遍历每个子目录
			for (const subdir of subdirs) {
				const subdirPath = path.join(cursorWorkspacePath, subdir);
				const stat = await fsPromises.stat(subdirPath);
				
				// 只处理目录
				if (stat.isDirectory()) {
					const workspaceJsonPath = path.join(subdirPath, 'workspace.json');
					
					try {
						// 检查 workspace.json 是否存在
						await fsPromises.access(workspaceJsonPath, fs.constants.F_OK);
						
						// 读取并解析 workspace.json
						const content = await fsPromises.readFile(workspaceJsonPath, 'utf-8');
						const json = JSON.parse(content);
						
						// 添加到结果集
						result.push({
							hash: subdir, // 使用子目录名作为 hash
							folder: json.folder || '未找到 folder 字段'
						});
					} catch (err) {
						// 忽略没有 workspace.json 的目录或解析失败的情况
						console.log(`子目录 ${subdir} 中没有有效的 workspace.json 文件`);
					}
				}
			}
			
			return result;
		} catch (err) {
			console.error('获取工作区目录树数据失败:', err);
			throw new Error('指定的 Cursor Workspace 路径不存在或无法访问！');
		}
	}

	// 切换到列表模式
	public switchToListMode() {
		this._currentMode = 'list';
		this._updateWebviewContent();
	}

	// 切换到设置模式
	public switchToSettingMode() {
		this._currentMode = 'setting';
		this._updateWebviewContent();
	}

	// 更新WebView中的设置值
	public updateSettings() {
		if (!this._view) {
			return;
		}
		
		// 获取当前设置
		const config = vscode.workspace.getConfiguration('svala');
		const settings = {
			type: 'updateSettings',
			cursorWorkspacePath: config.get('cursorWorkspacePath', '') as string,
			apiProvider: config.get('apiProvider', 'OpenAI') as string,
			apiBaseUrl: config.get('apiBaseUrl', 'http://localhost:11434') as string,
			apiKey: config.get('apiKey', '') as string,
			aiModel: config.get('aiModel', 'gpt-3.5-turbo') as string
		};
		
		// 发送更新消息
		this._view.webview.postMessage(settings);
	}

	private async _updateWebviewContent() {
		if (!this._view) {
			console.error('_updateWebviewContent: _view未定义，无法更新WebView内容');
			return;
		}
		
		try {
			if (this._currentMode === 'list') {
				this._view.webview.html = this._getListHtml();
			} else {
				this._view.webview.html = this._getSettingsHtml();
			}
		} catch (error) {
			console.error('更新WebView内容时出错:', error);
		}
	}

	// 生成列表页面HTML
	private _getListHtml() {
		return `<!DOCTYPE html>
		<html lang="zh-CN">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>人行照上传</title>
			<style>
				body {
					font-family: var(--vscode-font-family);
					color: var(--vscode-foreground);
					padding: 10px;
				}
				.header {
					display: flex;
					justify-content: space-between;
					align-items: center;
					margin-bottom: 20px;
				}
				.header-title {
					font-size: 18px;
					font-weight: bold;
				}
				.icon-button {
					background: transparent;
					border: none;
					color: var(--vscode-button-foreground);
					cursor: pointer;
					font-size: 16px;
					display: flex;
					align-items: center;
					padding: 5px;
				}
				.icon-button:hover {
					background: var(--vscode-button-hoverBackground);
					border-radius: 3px;
				}
				.icon-setting {
					margin-right: 5px;
				}
				.tree-view-container {
					margin-top: 20px;
					border: 1px solid var(--vscode-panel-border);
					border-radius: 3px;
					max-height: 500px;
					overflow: auto;
					position: relative; /* 为绝对定位的遮罩做准备 */
				}
				.tree-view-header {
					display: flex;
					font-weight: bold;
					padding: 8px;
					border-bottom: 1px solid var(--vscode-panel-border);
					background-color: var(--vscode-panel-background);
				}
				.tree-view-header .checkbox-col {
					width: 40px;
					text-align: center;
					display: flex;
					justify-content: center;
					align-items: center;
				}
				.tree-view-header .hash-col {
					width: 35%;
				}
				.tree-view-header .folder-col {
					width: 55%;
				}
				.tree-view-item {
					display: flex;
					padding: 6px 8px;
					border-bottom: 1px solid var(--vscode-panel-border);
				}
				.tree-view-item:last-child {
					border-bottom: none;
				}
				.tree-view-item:hover {
					background-color: var(--vscode-list-hoverBackground);
				}
				.tree-view-item .checkbox-col {
					width: 40px;
					display: flex;
					justify-content: center;
					align-items: center;
				}
				.tree-view-item .hash-col {
					width: 35%;
					overflow: hidden;
					text-overflow: ellipsis;
					white-space: nowrap;
					cursor: pointer;
					color: var(--vscode-textLink-foreground);
				}
				.tree-view-item .hash-col:hover {
					text-decoration: underline;
				}
				.tree-view-item .folder-col {
					width: 55%;
					overflow: hidden;
					text-overflow: ellipsis;
					white-space: nowrap;
					cursor: pointer;
					color: var(--vscode-textLink-foreground);
				}
				.tree-view-item .folder-col:hover {
					text-decoration: underline;
				}
				.loading {
					text-align: center;
					padding: 20px;
					color: var(--vscode-descriptionForeground);
				}
				.loading-spinner {
					display: inline-block;
					animation: spin 1.5s linear infinite;
				}
				@keyframes spin {
					0% { transform: rotate(0deg); }
					100% { transform: rotate(360deg); }
				}
				.button-loading {
					opacity: 0.7;
					cursor: not-allowed;
				}
				.error {
					color: var(--vscode-errorForeground);
					padding: 10px;
					border: 1px solid var(--vscode-errorForeground);
					border-radius: 3px;
					margin: 10px 0;
				}
				.button-container {
					display: flex;
					flex-direction: column;
					gap: 10px;
					margin-top: 10px;
				}
				.action-button {
					width: 100%;
					padding: 8px 12px;
					background-color: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
					border: none;
					border-radius: 2px;
					cursor: pointer;
					display: flex;
					align-items: center;
					justify-content: center;
				}
				.action-button:hover {
					background-color: var(--vscode-button-hoverBackground);
				}
				.action-button i {
					margin-right: 5px;
				}
				.checkbox-custom {
					appearance: none;
					-webkit-appearance: none;
					width: 16px;
					height: 16px;
					border: 1px solid var(--vscode-checkbox-border, #ccc);
					border-radius: 3px;
					cursor: pointer;
					position: relative;
					background-color: var(--vscode-checkbox-background, #ffffff);
					margin: 0;
					vertical-align: middle;
				}
				.checkbox-custom:checked {
					background-color: var(--vscode-button-background, #0e639c);
					border-color: var(--vscode-button-background, #0e639c);
				}
				.checkbox-custom:checked::after {
					content: '';
					position: absolute;
					left: 5px;
					top: 1px;
					width: 4px;
					height: 8px;
					border: solid white;
					border-width: 0 2px 2px 0;
					transform: rotate(45deg);
				}
				.checkbox-custom:focus {
					outline: 2px solid var(--vscode-focusBorder);
					outline-offset: 2px;
				}
				/* 加载遮罩样式 */
				.loading-overlay {
					position: absolute;
					top: 0;
					left: 0;
					right: 0;
					bottom: 0;
					background-color: rgba(0, 0, 0, 0.5);
					display: flex;
					justify-content: center;
					align-items: center;
					z-index: 10;
					opacity: 0;
					transition: opacity 0.2s ease-in-out;
					pointer-events: none; /* 允许点击穿透遮罩 */
				}
				.loading-overlay.visible {
					opacity: 1;
					pointer-events: all; /* 阻止点击穿透 */
				}
				.loading-indicator {
					color: var(--vscode-foreground);
					background-color: var(--vscode-panel-background);
					padding: 15px 25px;
					border-radius: 5px;
					box-shadow: 0 0 10px rgba(0, 0, 0, 0.2);
					display: flex;
					flex-direction: column;
					align-items: center;
					gap: 10px;
				}
				.loading-icon {
					font-size: 24px;
					animation: spin 1.5s linear infinite;
				}
				/* 搜索框样式 */
				.search-container {
					display: flex;
					margin-bottom: 10px;
					gap: 8px;
				}
				.search-input-wrapper {
					flex: 1;
				}
				.search-input {
					width: 100%;
					padding: 6px 10px;
					background: var(--vscode-input-background);
					color: var(--vscode-input-foreground);
					border: 1px solid var(--vscode-input-border);
					border-radius: 3px;
				}
				.search-input:focus {
					outline: 1px solid var(--vscode-focusBorder);
				}
				.search-button {
					padding: 6px 15px;
					background-color: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
					border: none;
					border-radius: 3px;
					cursor: pointer;
					display: flex;
					align-items: center;
					gap: 5px;
				}
				.search-button:hover {
					background-color: var(--vscode-button-hoverBackground);
				}
			</style>
			<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/bootstrap-icons.css">
		</head>
		<body>
			<div class="header">
				<div class="header-title">Cursor 工作区列表</div>
				<button id="showSettingsBtn" class="icon-button">
					<i class="bi bi-gear icon-setting"></i>设置
				</button>
			</div>
			
			<!-- 搜索框 -->
			<div class="search-container">
				<div class="search-input-wrapper">
					<input type="text" id="searchInput" placeholder="搜索..." class="search-input">
				</div>
				<button id="searchBtn" class="search-button">
					<i class="bi bi-search"></i> 搜索
				</button>
			</div>
			
			<div id="treeViewContainer" class="tree-view-container">
				<div class="tree-view-header">
					<div class="checkbox-col">
						<input type="checkbox" id="selectAllCheckbox" class="checkbox-custom" title="全选">
					</div>
					<div class="hash-col">Hash</div>
					<div class="folder-col">目录</div>
				</div>
				<div id="treeView">
					<div class="loading">正在加载工作区数据...</div>
				</div>
				
				<!-- 加载遮罩 -->
				<div id="loadingOverlay" class="loading-overlay">
					<div class="loading-indicator">
						<i class="bi bi-arrow-repeat loading-icon"></i>
						<div>正在加载...</div>
					</div>
				</div>
			</div>
			
			<div class="button-container">
				<button id="refreshBtn" class="action-button">
					<i class="bi bi-arrow-clockwise"></i> 刷新列表
				</button>
				<button id="exportBtn" class="action-button">
					<i class="bi bi-download"></i> 导出记录
				</button>
			</div>

			<script>
				(function() {
					const vscode = acquireVsCodeApi();
					const showSettingsBtn = document.getElementById('showSettingsBtn');
					const refreshBtn = document.getElementById('refreshBtn');
					const exportBtn = document.getElementById('exportBtn');
					const treeView = document.getElementById('treeView');
					const selectAllCheckbox = document.getElementById('selectAllCheckbox');
					const loadingOverlay = document.getElementById('loadingOverlay');
					const searchInput = document.getElementById('searchInput');
					const searchBtn = document.getElementById('searchBtn');
					
					// 存储所有选中的项
					let selectedItems = new Set();
					// 加载状态标记
					let isLoading = false;
					// 加载开始时间
					let loadingStartTime = 0;
					// 最小加载时间 (毫秒)
					const MIN_LOADING_TIME = 600;
					// 存储获取到的数据，等待显示
					let pendingTreeData = null;
					
					// 显示加载遮罩
					function showLoadingOverlay() {
						loadingOverlay.classList.add('visible');
						loadingStartTime = Date.now();
					}
					
					// 隐藏加载遮罩
					function hideLoadingOverlay() {
						const currentTime = Date.now();
						const elapsedTime = currentTime - loadingStartTime;
						
						if (elapsedTime >= MIN_LOADING_TIME) {
							// 如果已经过了最小显示时间，直接隐藏
							loadingOverlay.classList.remove('visible');
							
							// 如果有待显示的数据，现在显示它
							if (pendingTreeData !== null) {
								renderTree(pendingTreeData);
								pendingTreeData = null;
							}
						} else {
							// 否则，延迟隐藏以满足最小显示时间
							const remainingTime = MIN_LOADING_TIME - elapsedTime;
							setTimeout(() => {
								loadingOverlay.classList.remove('visible');
								
								// 如果有待显示的数据，现在显示它
								if (pendingTreeData !== null) {
									renderTree(pendingTreeData);
									pendingTreeData = null;
								}
							}, remainingTime);
						}
					}
					
					// 设置加载状态
					function setLoadingState(loading) {
						isLoading = loading;
						
						if (loading) {
							// 设置刷新按钮为加载状态
							refreshBtn.classList.add('button-loading');
							refreshBtn.disabled = true;
							
							// 更改图标为旋转动画
							const icon = refreshBtn.querySelector('i');
							icon.classList.add('loading-spinner');
							
							// 更改按钮文本
							refreshBtn.innerHTML = refreshBtn.innerHTML.replace('刷新列表', '加载中...');
							
							// 显示加载遮罩
							showLoadingOverlay();
						} else {
							// 恢复刷新按钮状态
							refreshBtn.classList.remove('button-loading');
							refreshBtn.disabled = false;
							
							// 恢复图标
							const icon = refreshBtn.querySelector('i');
							if (icon) {
								icon.classList.remove('loading-spinner');
							}
							
							// 恢复按钮文本
							refreshBtn.innerHTML = '<i class="bi bi-arrow-clockwise"></i> 刷新列表';
							
							// 隐藏加载遮罩
							hideLoadingOverlay();
						}
					}
					
					// 设置按钮点击事件
					showSettingsBtn.addEventListener('click', () => {
						vscode.postMessage({
							type: 'switchToSettings'
						});
					});
					
					// 刷新按钮点击事件
					refreshBtn.addEventListener('click', () => {
						if (isLoading) return; // 如果正在加载，忽略点击
						
						// 设置加载状态
						setLoadingState(true);
						
						// 不再清空树状视图，保持原内容直到新数据准备好
						selectedItems.clear();
						updateSelectAllCheckbox();
						
						// 请求工作区树数据
						vscode.postMessage({
							type: 'getWorkspaceTree'
						});
					});
					
					// 导出按钮点击事件
					exportBtn.addEventListener('click', () => {
						if (selectedItems.size === 0) {
							alert('请至少选择一项记录');
							return;
						}
						
						const selectedData = Array.from(selectedItems);
						console.log('导出选中的项：', selectedData);
						
						vscode.postMessage({
							type: 'exportRecords',
							items: selectedData
						});
					});
					
					// 全选复选框点击事件
					selectAllCheckbox.addEventListener('change', () => {
						const checkboxes = document.querySelectorAll('.item-checkbox');
						const isChecked = selectAllCheckbox.checked;
						
						checkboxes.forEach(checkbox => {
							checkbox.checked = isChecked;
							const hash = checkbox.getAttribute('data-hash');
							const folder = checkbox.getAttribute('data-folder');
							
							if (isChecked) {
								selectedItems.add({ hash, folder });
							} else {
								selectedItems.delete({ hash, folder });
							}
						});
					});
					
					// 更新全选复选框状态
					function updateSelectAllCheckbox() {
						const checkboxes = document.querySelectorAll('.item-checkbox');
						const checkedCount = document.querySelectorAll('.item-checkbox:checked').length;
						
						if (checkboxes.length === 0) {
							selectAllCheckbox.checked = false;
							selectAllCheckbox.indeterminate = false;
						} else if (checkedCount === 0) {
							selectAllCheckbox.checked = false;
							selectAllCheckbox.indeterminate = false;
						} else if (checkedCount === checkboxes.length) {
							selectAllCheckbox.checked = true;
							selectAllCheckbox.indeterminate = false;
						} else {
							selectAllCheckbox.checked = false;
							selectAllCheckbox.indeterminate = true;
						}
					}
					
					// 渲染树形视图
					function renderTree(data) {
						if (!data || data.length === 0) {
							treeView.innerHTML = '<div class="loading">未找到工作区数据</div>';
							return;
						}
						
						treeView.innerHTML = '';
						data.forEach(item => {
							const row = document.createElement('div');
							row.className = 'tree-view-item';
							
							// 添加复选框列
							const checkboxCol = document.createElement('div');
							checkboxCol.className = 'checkbox-col';
							
							const checkbox = document.createElement('input');
							checkbox.type = 'checkbox';
							checkbox.className = 'checkbox-custom item-checkbox';
							checkbox.setAttribute('data-hash', item.hash);
							checkbox.setAttribute('data-folder', item.folder);
							
							checkbox.addEventListener('change', function() {
								const hash = this.getAttribute('data-hash');
								const folder = this.getAttribute('data-folder');
								
								if (this.checked) {
									selectedItems.add({ hash, folder });
								} else {
									selectedItems.delete({ hash, folder });
								}
								
								updateSelectAllCheckbox();
							});
							
							checkboxCol.appendChild(checkbox);
							
							// 截断 Hash 值，显示开头和结尾各3个字符
							const hashCol = document.createElement('div');
							hashCol.className = 'hash-col';
							
							const originalHash = item.hash;
							let displayHash = originalHash;
							if (originalHash.length > 8) {
								displayHash = originalHash.substring(0, 3) + '...' + originalHash.substring(originalHash.length - 3);
							}
							
							hashCol.textContent = displayHash;
							hashCol.title = '查看聊天记录';
							hashCol.setAttribute('data-full-hash', originalHash);
							
							hashCol.addEventListener('click', () => {
								vscode.postMessage({
									type: 'openSecondarySidebar',
									hash: originalHash
								});
							});
							
							// 只显示目录路径的最后一个部分
							const folderCol = document.createElement('div');
							folderCol.className = 'folder-col';
							
							const fullFolder = item.folder;
							let displayFolder = fullFolder;
							
							// 提取路径最后一个部分
							if (fullFolder) {
								const parts = fullFolder.split(/[\\/]/); // 处理正斜杠和反斜杠
								displayFolder = parts[parts.length - 1] || fullFolder;
							}
							
							folderCol.textContent = displayFolder;
							folderCol.title = '打开该项目: ' + fullFolder;
							folderCol.setAttribute('data-full-folder', fullFolder);
							
							folderCol.addEventListener('click', () => {
								vscode.postMessage({
									type: 'openFolder',
									folder: fullFolder,
									hash: originalHash
								});
							});
							
							row.appendChild(checkboxCol);
							row.appendChild(hashCol);
							row.appendChild(folderCol);
							treeView.appendChild(row);
						});
						
						// 更新全选复选框状态
						updateSelectAllCheckbox();
					}
					
					// 监听来自扩展的消息
					window.addEventListener('message', event => {
						const message = event.data;
						
						switch (message.type) {
							case 'workspaceTree':
								// 存储数据，但在满足最小加载时间后再显示
								pendingTreeData = message.data;
								
								// 移除加载状态，这会处理最小显示时间并最终显示数据
								setLoadingState(false);
								break;
							case 'workspaceTreeError':
								console.error('获取工作区树数据失败:', message.message);
								
								// 存储错误信息，但在满足最小加载时间后再显示
								pendingTreeData = null;
								
								// 在延迟后设置错误信息
								const currentTime = Date.now();
								const elapsedTime = currentTime - loadingStartTime;
								
								if (elapsedTime >= MIN_LOADING_TIME) {
									// 如果已经过了最小显示时间，直接显示错误
									treeView.innerHTML = \`<div class="error">\${message.message}</div>\`;
								} else {
									// 否则，延迟显示错误以满足最小显示时间
									const remainingTime = MIN_LOADING_TIME - elapsedTime;
									setTimeout(() => {
										treeView.innerHTML = \`<div class="error">\${message.message}</div>\`;
									}, remainingTime);
								}
								
								// 移除加载状态
								setLoadingState(false);
								break;
						}
					});
					
					// 页面加载完成后请求工作区树数据
					document.addEventListener('DOMContentLoaded', () => {
						// 如果是初始加载，显示加载提示但不显示遮罩
						treeView.innerHTML = '<div class="loading">正在加载工作区数据...</div>';
						
						// 设置加载状态
						setLoadingState(true);
						vscode.postMessage({
							type: 'getWorkspaceTree'
						});
					});
					
					// 立即请求工作区树数据（以防DOMContentLoaded已经触发）
					if (treeView.innerHTML.trim() === '') {
						treeView.innerHTML = '<div class="loading">正在加载工作区数据...</div>';
					}
					setLoadingState(true);
					vscode.postMessage({
						type: 'getWorkspaceTree'
					});

					// 搜索按钮点击事件
					searchBtn.addEventListener('click', () => {
						performSearch();
					});
					
					// 搜索框回车事件
					searchInput.addEventListener('keypress', (e) => {
						if (e.key === 'Enter') {
							performSearch();
						}
					});
					
					// 执行搜索
					function performSearch() {
						const searchTerm = searchInput.value.trim().toLowerCase();
						console.log('搜索关键词：', searchTerm);
						
						// 搜索功能逻辑将在后续实现
						// 目前仅显示一个提示消息
						vscode.postMessage({
							type: 'showMessage',
							message: '搜索功能即将实现：' + searchTerm
						});
					}
				}())
			</script>
		</body>
		</html>`;
	}

	// 生成设置页面HTML
	private _getSettingsHtml() {
		// 获取当前设置
		const config = vscode.workspace.getConfiguration('svala');
		const cursorWorkspacePath = config.get('cursorWorkspacePath', '') as string;
		const apiProvider = config.get('apiProvider', 'OpenAI') as string;
		const apiBaseUrl = config.get('apiBaseUrl', 'http://localhost:11434') as string;
		const apiKey = config.get('apiKey', '') as string;
		const aiModel = config.get('aiModel', 'gpt-3.5-turbo') as string;

		// 为API供应商生成选中状态
		const openaiSelected = apiProvider === 'OpenAI' ? 'selected' : '';
		const ollamaSelected = apiProvider === 'Ollama' ? 'selected' : '';
		const geminiSelected = apiProvider === 'Google Gemini' ? 'selected' : '';
		const xaiSelected = apiProvider === 'xAI' ? 'selected' : '';
		const deepseekSelected = apiProvider === 'DeepSeek' ? 'selected' : '';

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
				.header {
					display: flex;
					justify-content: space-between;
					align-items: center;
					margin-bottom: 20px;
				}
				.header-title {
					font-size: 18px;
					font-weight: bold;
				}
				.icon-button {
					background: transparent;
					border: none;
					color: var(--vscode-button-foreground);
					cursor: pointer;
					font-size: 16px;
					display: flex;
					align-items: center;
					padding: 5px;
				}
				.icon-button:hover {
					background: var(--vscode-button-hoverBackground);
					border-radius: 3px;
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
				.icon-list {
					margin-right: 5px;
				}
				.hidden {
					display: none;
				}
				.hint-text {
					font-size: 12px;
					color: var(--vscode-descriptionForeground);
					margin-top: 4px;
					font-style: italic;
				}
				.hint-description {
					font-size: 12px;
					color: var(--vscode-descriptionForeground);
					margin-top: 8px;
					padding: 8px;
					border: 1px solid var(--vscode-panel-border);
					border-radius: 4px;
					background-color: var(--vscode-editor-background);
				}
				.hint-description p {
					margin: 4px 0;
				}
				.hint-description ul {
					margin: 4px 0;
					padding-left: 20px;
				}
			</style>
			<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/bootstrap-icons.css">
		</head>
		<body>
			<form class="settings-form">
				<div class="form-group">
					<label for="cursorWorkspacePath">Cursor Workspace Path</label>
					<div class="folder-input-group">
						<input type="text" id="cursorWorkspacePath" value="${cursorWorkspacePath}" />
						<button type="button" id="selectFolderBtn">浏览...</button>
					</div>
					<div class="hint-text">请选择Cursor应用程序目录，系统将自动定位到User/workspaceStorage路径</div>
					<div class="hint-description">
						<p>Cursor聊天记录存储在两个位置：</p>
						<ul>
							<li>工作区存储 (workspaceStorage): 包含对话的ID和索引</li>
							<li>全局存储 (globalStorage): 包含对话的详细内容和消息记录</li>
						</ul>
						<p>系统会自动检测并关联这两种存储以获取完整聊天记录。</p>
				</div>
				</div>
			</form>
		</body>
		</html>`;
	}

	// 生成错误页面HTML
	private _getErrorHtml(errorMessage: string): string {
		return generateErrorHtml(errorMessage);
	}

	// 生成聊天记录页面HTML
	private async _getChatHistoryHtml(hash: string, hashFolderPath: string, globalDbPath: string, composerId?: string): Promise<string> {
		try {
			// 步骤1: 定位工作区数据库
			const workspaceDbPath = findWorkspaceDb(hashFolderPath);
			if (!workspaceDbPath) {
				throw new Error(`在工作区目录下未找到 state.vscdb 数据库文件`);
			}
			// 步骤2-5: 获取完整对话（支持传入 composerId）
			const { mainRecord, bubbles, allComposers } = await getFullConversation(workspaceDbPath, globalDbPath, hash, composerId);
			// 步骤6: 生成HTML，传递所有对话引用
			return this._generateChatHistoryHtml(mainRecord, bubbles, allComposers, hash);
		} catch (error) {
			console.error('生成聊天记录HTML失败:', error);
			return this._getErrorHtml(error instanceof Error ? error.message : '未知错误');
		}
	}
	
	// 生成聊天记录HTML
	private _generateChatHistoryHtml(mainRecord: MainRecord, bubbles: BubbleRecord[], allComposers: ComposerRef[], hash: string): string {
		return `<!DOCTYPE html>
		<html lang="zh-CN">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>聊天记录</title>
			<style>
				body {
					font-family: var(--vscode-font-family);
					color: var(--vscode-foreground);
					background-color: var(--vscode-editor-background);
					margin: 0;
					padding: 0;
				}
				.container {
					display: flex;
					height: 100vh;
				}
				.sidebar {
					width: 240px;
					background: var(--vscode-sideBar-background, #f3f3f3);
					border-right: 1px solid var(--vscode-panel-border, #eee);
					overflow-y: auto;
					padding-top: 10px;
				}
				.composer-item {
					padding: 10px 18px;
					cursor: pointer;
					border-left: 4px solid transparent;
					color: var(--vscode-foreground);
					transition: background 0.2s;
				}
				.composer-item.active {
					background: var(--vscode-list-activeSelectionBackground, #e0e0e0);
					border-left: 4px solid var(--vscode-button-background, #0e639c);
					font-weight: bold;
				}
				.composer-item:hover {
					background: var(--vscode-list-hoverBackground, #eaeaea);
				}
				.chat-main {
					flex: 1;
					padding: 24px 32px;
					overflow-y: auto;
					display: flex;
					flex-direction: column;
				}
				.header {
					margin-bottom: 20px;
					border-bottom: 1px solid var(--vscode-panel-border);
					padding-bottom: 10px;
				}
				.header h1 {
					margin: 0;
					font-size: 22px;
					color: var(--vscode-foreground);
				}
				.header .date {
					color: var(--vscode-descriptionForeground);
					font-size: 12px;
					margin-top: 5px;
				}
				.chat-container {
					display: flex;
					flex-direction: column;
				}
				.message {
					display: flex;
					flex-direction: column;
					max-width: 70%;
					margin-bottom: 15px;
					padding: 10px 15px;
					border-radius: 12px;
					position: relative;
				}
				.message.assistant {
					align-self: flex-start;
					background: #f5f5f5;
					color: #222;
					border-top-left-radius: 0;
				}
				.message.user {
					align-self: flex-end;
					background: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
					border-top-right-radius: 0;
				}
				.message .content {
					white-space: pre-wrap;
					word-break: break-word;
				}
				.message .time {
					font-size: 10px;
					color: var(--vscode-descriptionForeground);
					margin-top: 5px;
					text-align: right;
				}
				.empty-message {
					text-align: center;
					color: var(--vscode-descriptionForeground);
					margin: 50px 0;
				}
			</style>
		</head>
		<body>
			<div class="container">
				<div class="sidebar">
					${allComposers.map(c => `
					  <div class="composer-item${c.composerId === mainRecord.composerId ? ' active' : ''}" 
						   data-composer-id="${c.composerId}">
						${c.title || c.composerId.substring(0,8)}
					  </div>
					`).join('')}
				</div>
				<div class="chat-main">
					${this._renderChatMainHtml(mainRecord, bubbles)}
				</div>
			</div>
			<script>
			
			// 只注入安全内容
			window.currentHash = ${JSON.stringify(hash)};

			// 全局声明 vscode，所有函数都能访问
			const vscode = acquireVsCodeApi();
			// 全局渲染函数，AI在左，用户在右
			function renderChatMain(mainRecord, bubbles) {
				const title = mainRecord.title || ('对话 ' + mainRecord.composerId.substring(0, 8));
				const dateStr = mainRecord.createdAt ? new Date(mainRecord.createdAt).toLocaleString() : '未知时间';
				const bubblesHtml = bubbles.length > 0 
					? bubbles.map(function(bubble, idx) {
						const time = new Date(bubble.createdAt).toLocaleString();
						const isUser = bubble.role === 'user';
						let content = bubble.content || '';
						content = content.replace(/&/g, '&amp;')
							.replace(/</g, '&lt;')
							.replace(/>/g, '&gt;')
							.replace(/"/g, '&quot;')
							.replace(/'/g, '&#039;')
							.replace(/\\n/g, '<br>');
						return '<div class="message ' + (isUser ? 'user' : 'assistant') + '">' +
							'<div class="content">' + content + '</div>' +
							'<div class="time">' + time + '</div>' +
						'</div>';
					}).join('') 
					: '<div class="empty-message">没有找到聊天记录</div>';
				return '<div class="header">' +
					'<h1>' + title + '</h1>' +
					'<div class="date">创建于: ' + dateStr + '</div>' +
				'</div>' +
				'<div class="chat-container">' +
					bubblesHtml +
				'</div>';
			}

			// 事件绑定函数，暴露为全局
			function bindComposerClick() {
				document.querySelectorAll('.composer-item').forEach(function(item) {
					item.addEventListener('click', function() {
						const composerId = this.getAttribute('data-composer-id');
						if (composerId) {
							vscode.postMessage({ type: 'getChatContent', hash: window.currentHash, composerId });
							// 高亮
							document.querySelectorAll('.composer-item').forEach(function(i) {
								i.classList.remove('active');
							});
							this.classList.add('active');
						}
					});
				});
			}

			document.addEventListener('DOMContentLoaded', function() {
				bindComposerClick();
				// 监听内容切换
				window.addEventListener('message', function(event) {
					const msg = event.data;
					console.log('[收到消息]', msg);
					const chatMain = document.querySelector('.chat-main');
					if (msg.type === 'chatContent' && chatMain) {
						chatMain.innerHTML = renderChatMain(msg.mainRecord, msg.bubbles);
						// 每次渲染后都重新绑定事件
						bindComposerClick();
					}
					else if (msg.type === 'chatContentError' && chatMain) {
						chatMain.innerHTML = '<div class="empty-message">' + msg.message + '</div>';
					}
				});
			});

			console.log('typeof vscode', typeof vscode);
console.log('typeof vscode.postMessage', typeof vscode.postMessage);
			</script>
		</body>
		</html>`;
	}

	// 新增：用于初始渲染右侧内容
	private _renderChatMainHtml(mainRecord: MainRecord, bubbles: BubbleRecord[]): string {
		const title = mainRecord.title || `对话 ${mainRecord.composerId.substring(0, 8)}`;
		const dateStr = mainRecord.createdAt ? new Date(mainRecord.createdAt).toLocaleString() : '未知时间';
		const bubblesHtml = bubbles.length > 0 
			? bubbles.map((bubble, idx) => {
				const time = new Date(bubble.createdAt).toLocaleString();
				const isUser = bubble.role === 'user';
				let content = bubble.content || '';
				content = content.replace(/&/g, '&amp;')
					.replace(/</g, '&lt;')
					.replace(/>/g, '&gt;')
					.replace(/"/g, '&quot;')
					.replace(/'/g, '&#039;')
					.replace(/\\n/g, '<br>');
				
				return `<div class="message ${isUser ? 'user' : 'assistant'}">
					<div class="content">${content}</div>
					<div class="time">${time}</div>
				</div>`;
			}).join('') 
			: '<div class="empty-message">没有找到聊天记录</div>';
		return `<div class="header">
			<h1>${title}</h1>
			<div class="date">创建于: ${dateStr}</div>
		</div>
		<div class="chat-container">
			${bubblesHtml}
		</div>`;
	}

	// 添加公共方法，用于触发选择文件夹
	public triggerSelectFolder(): void {
		if (this._view) {
			this._view.webview.postMessage({ 
				type: 'triggerSelectFolder' 
			});
		}
	}
}

// 获取Cursor全局存储路径
function getCursorGlobalStoragePath(): string | undefined {
	try {
		// 获取用户主目录
		const homeDir = os.homedir();
		
		// 构建Cursor全局存储路径
		// macOS: ~/Library/Application Support/cursor/User/globalStorage
		// Windows: %APPDATA%\cursor\User\globalStorage
		// Linux: ~/.config/cursor/User/globalStorage
		
		let globalStoragePath: string;
		
		if (process.platform === 'darwin') {
			// macOS
			globalStoragePath = path.join(homeDir, 'Library', 'Application Support', 'cursor', 'User', 'globalStorage');
		} else if (process.platform === 'win32') {
			// Windows
			globalStoragePath = path.join(process.env.APPDATA || '', 'cursor', 'User', 'globalStorage');
		} else {
			// Linux或其他平台
			globalStoragePath = path.join(homeDir, '.config', 'cursor', 'User', 'globalStorage');
		}
		
		// 检查路径是否存在
		if (fs.existsSync(globalStoragePath)) {
			console.log(`找到Cursor全局存储路径: ${globalStoragePath}`);
			
			// 在全局存储中查找state.vscdb文件
			const stateDbPath = path.join(globalStoragePath, 'state.vscdb');
			console.log(`检查state.vscdb文件: ${stateDbPath}`);
			if (fs.existsSync(stateDbPath)) {
				console.log(`找到全局存储数据库: ${stateDbPath}`);
				return stateDbPath;
			}
			
			console.log('在全局存储中没有找到state.vscdb文件');
				return undefined;
		} else {
			console.log(`Cursor全局存储路径不存在: ${globalStoragePath}`);
			return undefined;
		}
	} catch (error) {
		console.error('获取Cursor全局存储路径出错:', error);
		return undefined;
	}
}

// 扩展激活入口点
export function activate(context: vscode.ExtensionContext) {
	console.log('Svala 扩展已激活');
	
	try {
		// 创建主视图提供者实例
		const mainViewProvider = new MainViewProvider(context.extensionUri);
		console.log('MainViewProvider 实例已创建');
		
		// 注册主视图提供者
		context.subscriptions.push(
			vscode.window.registerWebviewViewProvider(
				MainViewProvider.viewType,
				mainViewProvider,
				{
					webviewOptions: {
						retainContextWhenHidden: true  // 保持上下文，避免视图重新加载
					}
				}
			)
		);
		console.log('MainViewProvider 已注册，viewType:', MainViewProvider.viewType);

		// 注册设置命令 - 切换到设置模式
		const configCommand = vscode.commands.registerCommand('svala.config', () => {
			try {
			console.log('执行svala.config命令');
			// 显示侧边栏并切换到设置模式
			vscode.commands.executeCommand('workbench.view.extension.svala').then(() => {
				// 确保侧边栏已经显示后再切换模式
				mainViewProvider.switchToSettingMode();
				console.log('已切换到设置模式');
				}, (err: Error) => {
					console.error('显示侧边栏失败:', err);
					vscode.window.showErrorMessage(`显示侧边栏失败: ${err}`);
			});
			} catch (error) {
				console.error('svala.config命令执行错误:', error);
				vscode.window.showErrorMessage(`设置命令执行错误: ${error}`);
			}
		});
		context.subscriptions.push(configCommand);
		console.log('svala.config 命令已注册');

		// 注册列表命令 - 切换到列表模式
		const showListCommand = vscode.commands.registerCommand('svala.showList', () => {
			try {
			console.log('执行svala.showList命令');
			// 显示侧边栏并切换到列表模式
			vscode.commands.executeCommand('workbench.view.extension.svala').then(() => {
				// 确保侧边栏已经显示后再切换模式
				mainViewProvider.switchToListMode();
				console.log('已切换到列表模式');
				}, (err: Error) => {
					console.error('显示侧边栏失败:', err);
					vscode.window.showErrorMessage(`显示侧边栏失败: ${err}`);
				});
			} catch (error) {
				console.error('svala.showList命令执行错误:', error);
				vscode.window.showErrorMessage(`列表命令执行错误: ${error}`);
			}
		});
		context.subscriptions.push(showListCommand);
		console.log('svala.showList 命令已注册');
		
		// 注册分析命令
		const analyzeCommand = vscode.commands.registerCommand('svala.analyze', () => {
			try {
				console.log('执行svala.analyze命令');
				vscode.window.showInformationMessage('分析功能即将推出');
			} catch (error) {
				console.error('svala.analyze命令执行错误:', error);
				vscode.window.showErrorMessage(`分析命令执行错误: ${error}`);
			}
		});
		context.subscriptions.push(analyzeCommand);
		console.log('svala.analyze 命令已注册');
		
		// 注册选择工作区路径命令
		const selectWorkspacePathCommand = vscode.commands.registerCommand('svala.selectWorkspacePath', () => {
			try {
				console.log('执行svala.selectWorkspacePath命令');
				// 显示侧边栏并切换到设置模式
				vscode.commands.executeCommand('workbench.view.extension.svala').then(() => {
					// 确保侧边栏已经显示后再切换模式
					mainViewProvider.switchToSettingMode();
					console.log('已切换到设置模式，准备选择工作区路径');
					
					// 使用公共方法触发选择文件夹
					mainViewProvider.triggerSelectFolder();
				}, (err: Error) => {
					console.error('显示侧边栏失败:', err);
					vscode.window.showErrorMessage(`显示侧边栏失败: ${err}`);
				});
			} catch (error) {
				console.error('svala.selectWorkspacePath命令执行错误:', error);
				vscode.window.showErrorMessage(`选择工作区路径命令执行错误: ${error}`);
			}
		});
		context.subscriptions.push(selectWorkspacePathCommand);
		console.log('svala.selectWorkspacePath 命令已注册');
		
		// 注册获取视图信息命令（用于调试）
		const getViewsCommand = vscode.commands.registerCommand('svala.getViews', () => {
			try {
				console.log('执行svala.getViews命令');
				vscode.window.showInformationMessage(`MainViewProvider.viewType: ${MainViewProvider.viewType}`);
			} catch (error) {
				console.error('svala.getViews命令执行错误:', error);
				vscode.window.showErrorMessage(`获取视图信息命令执行错误: ${error}`);
			}
		});
		context.subscriptions.push(getViewsCommand);
		console.log('svala.getViews 命令已注册');
		
		console.log('所有命令注册完成');
	} catch (error) {
		console.error('扩展激活过程中出错:', error);
		vscode.window.showErrorMessage(`扩展激活失败: ${error}`);
	}
}

// 扩展停用时的清理函数
export function deactivate() {
	console.log('Svala 扩展已停用');
	
	// 关闭聊天记录面板（如果存在）
	if (chatHistoryPanel) {
		chatHistoryPanel.dispose();
		chatHistoryPanel = undefined;
	}
}

// ==================== 业务逻辑层 ====================

/**
 * 查找工作区数据库路径
 * @param hashFolderPath 工作区目录路径
 * @returns 数据库路径或null
 */
function findWorkspaceDb(hashFolderPath: string): string | null {
    try {
        // 尝试在hash目录下找state.vscdb
        const directDbPath = path.join(hashFolderPath, 'state.vscdb');
        if (fs.existsSync(directDbPath)) {
            console.log(`找到工作区数据库: ${directDbPath}`);
            return directDbPath;
        }
        
        // 检查 .cursor 目录
        const cursorDbPath = path.join(hashFolderPath, '.cursor', 'state.vscdb');
        if (fs.existsSync(cursorDbPath)) {
            console.log(`找到 .cursor 子目录下的数据库: ${cursorDbPath}`);
            return cursorDbPath;
        }
        
        // 检查 .vscode 目录
        const vscodeDbPath = path.join(hashFolderPath, '.vscode', 'state.vscdb');
        if (fs.existsSync(vscodeDbPath)) {
            console.log(`找到 .vscode 子目录下的数据库: ${vscodeDbPath}`);
            return vscodeDbPath;
        }
        
        // 递归搜索前3层子目录
        console.log('尝试递归搜索子目录...');
        const searchDbInDir = (dir: string, depth: number = 0): string | null => {
            if (depth > 3) return null;
            
            try {
                const files = fs.readdirSync(dir);
                
                // 先检查当前目录
                if (files.includes('state.vscdb')) {
                    return path.join(dir, 'state.vscdb');
                }
                
                // 然后检查子目录
                for (const file of files) {
                    const fullPath = path.join(dir, file);
                    try {
                        if (fs.statSync(fullPath).isDirectory()) {
                            const result = searchDbInDir(fullPath, depth + 1);
                            if (result) return result;
                        }
                    } catch (e) {
                        // 忽略权限错误等
                    }
                }
            } catch (e) {
                // 忽略目录读取错误
            }
            
            return null;
        };
        
        const foundDbPath = searchDbInDir(hashFolderPath);
        if (foundDbPath) {
            console.log(`递归搜索找到数据库: ${foundDbPath}`);
            return foundDbPath;
        }
        
        return null;
    } catch (error) {
        console.error('查找工作区数据库失败:', error);
        return null;
    }
}

/**
 * 获取完整的对话内容
 * @param workspaceDbPath 工作区数据库路径
 * @param globalDbPath 全局存储数据库路径
 * @param hash 工作区目录名（hash）
 * @returns 对话详情和气泡内容
 */
async function getFullConversation(workspaceDbPath: string, globalDbPath: string, hash: string, composerId?: string) {
    try {
        // 1. 从工作区获取所有对话引用
        const composers = await getAllComposersFromWorkspaceDb(workspaceDbPath);
        if (composers.length === 0) {
            throw new Error(`在工作区 ${hash} 中没有找到任何对话记录`);
        }
        // 2. 选择对话（支持传入 composerId，否则默认最新）
        composers.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        const targetComposerId = composerId || composers[0].composerId;
        // 3. 获取对话元数据
        const mainRecord = await getMainRecordFromGlobalDb(globalDbPath, targetComposerId);
        if (!mainRecord) {
            throw new Error(`未找到对话记录 (ID: ${targetComposerId})`);
        }
        
		console.log(`mainRecord: ${JSON.stringify(composers)}`);
        // 4. 获取所有气泡内容
        const bubbles = await getBubblesFromGlobalDb(globalDbPath, targetComposerId);
        // 5. 返回完整对话和所有对话引用
        return { mainRecord, bubbles, allComposers: composers };
    } catch (error) {
        console.error('获取完整对话失败:', error);
        throw error;
    }
}

/**
 * 格式化消息内容，处理Markdown和代码块
 * @param content 原始消息内容
 * @returns 格式化后的HTML
 */
function formatMessageContent(content: string): string {
    try {
        // 使用marked库处理Markdown，使用同步模式
        const options = { async: false };
        // 强制类型转换为字符串，因为我们使用了同步模式
        return marked.parse(content, options) as string;
    } catch (error) {
        console.error('格式化消息内容失败:', error);
        // 如果处理失败，返回原始内容，但进行HTML转义
        return content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
            .replace(/\\n/g, '<br>');
    }
}

/**
 * 生成错误页面HTML
 * @param errorMessage 错误信息
 * @returns HTML字符串
 */
function generateErrorHtml(errorMessage: string): string {
    return `<!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>错误</title>
        <style>
            body {
                font-family: var(--vscode-font-family);
                color: var(--vscode-foreground);
                padding: 20px;
                text-align: center;
            }
            .error-container {
                margin-top: 50px;
            }
            .error-icon {
                font-size: 48px;
                color: var(--vscode-errorForeground);
                margin-bottom: 20px;
            }
            .error-message {
                color: var(--vscode-errorForeground);
                font-size: 16px;
                margin-bottom: 20px;
            }
            .back-button {
                padding: 8px 16px;
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                border-radius: 2px;
                cursor: pointer;
            }
            .back-button:hover {
                background-color: var(--vscode-button-hoverBackground);
            }
        </style>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/bootstrap-icons.css">
    </head>
    <body>
        <div class="error-container">
            <div class="error-icon">
                <i class="bi bi-exclamation-triangle"></i>
            </div>
            <div class="error-message">
                ${errorMessage}
            </div>
        </div>
    </body>
    </html>`;
}
