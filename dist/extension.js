/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ([
/* 0 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


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
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.activate = activate;
exports.deactivate = deactivate;
// 添加全局变量用于跟踪聊天记录面板
let chatHistoryPanel;
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = __importStar(__webpack_require__(1));
const fs = __importStar(__webpack_require__(2));
const os = __importStar(__webpack_require__(3));
const path = __importStar(__webpack_require__(4));
// 导入 sqlite3 用于读取数据库
// 使用 @vscode/sqlite3 依赖
const sqlite3 = __webpack_require__(5);
const marked = __importStar(__webpack_require__(6));
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
function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) {
                reject(err);
            }
            else {
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
function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                reject(err);
            }
            else {
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
async function getAllComposersFromWorkspaceDb(workspaceDbPath) {
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
        console.log('composers', composers);
        // 提取所有 composerId 和相关信息
        const composerRefs = composers.map((composer) => ({
            composerId: composer.composerId,
            title: composer.name || `对话 ${composer.composerId ? composer.composerId.substring(0, 8) : '未知'}`,
            createdAt: composer.createdAt,
            folder: composer.folder
        }));
        return composerRefs;
    }
    catch (error) {
        console.error('获取对话引用失败:', error);
        throw new Error(`获取对话引用失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
    finally {
        db.close();
    }
}
/**
 * 从全局存储中获取对话元数据
 * @param globalDbPath 全局存储数据库路径
 * @param composerId 对话ID
 * @returns 对话元数据或null
 */
async function getMainRecordFromGlobalDb(globalDbPath, composerId) {
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
    }
    catch (error) {
        console.error(`获取对话元数据失败 (composerId: ${composerId}):`, error);
        throw new Error(`获取对话元数据失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
    finally {
        db.close();
    }
}
/**
 * 从全局存储中获取对话的所有气泡内容
 * @param globalDbPath 全局存储数据库路径
 * @param composerId 对话ID
 * @returns 气泡记录数组
 */
async function getBubblesFromGlobalDb(globalDbPath, composerId) {
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
        const bubbles = [];
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
                if (bubbleData.text) {
                    bubbles.push({
                        bubbleId: bubbleId,
                        role: bubbleData.type === 1 ? 'user' : 'assistant',
                        content: bubbleData.text || '',
                        createdAt: bubbleData.createdAt || 0
                    });
                }
            }
            catch (parseError) {
                console.warn(`解析气泡记录失败: ${row.key}`, parseError);
                // 继续处理下一条记录
            }
        }
        // 按创建时间排序
        return bubbles.sort((a, b) => a.createdAt - b.createdAt);
    }
    catch (error) {
        console.error(`获取气泡内容失败 (composerId: ${composerId}):`, error);
        throw new Error(`获取气泡内容失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
    finally {
        db.close();
    }
}
// 辅助函数：检查文件是否是有效的 Cursor 数据库
async function isCursorDatabase(filePath) {
    return new Promise((resolve) => {
        try {
            console.log(`检查文件是否是 Cursor 数据库: ${filePath}`);
            // 尝试打开数据库
            const db = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, (err) => {
                if (err) {
                    console.log(`打开数据库失败: ${err.message}`);
                    resolve(false);
                    return;
                }
                // 检查表结构
                db.all("SELECT name FROM sqlite_master WHERE type='table'", (tableErr, tables) => {
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
                    db.get(`SELECT COUNT(*) as count FROM ${tableName} WHERE key LIKE 'composerData:%' LIMIT 1`, (countErr, result) => {
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
        }
        catch (error) {
            console.error(`检查数据库出错: ${error}`);
            resolve(false);
        }
    });
}
// 辅助函数：深度递归搜索 Cursor 数据库文件
async function findCursorDatabase(dirPath, maxDepth = 5) {
    console.log(`在目录中搜索 Cursor 数据库: ${dirPath}，最大深度: ${maxDepth}`);
    const search = async (dir, depth = 0) => {
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
        }
        catch (error) {
            console.log(`读取目录 ${dir} 时出错: ${error}`);
            return null;
        }
    };
    return search(dirPath);
}
// 主视图提供者 - 可切换列表和设置模式
class MainViewProvider {
    _extensionUri;
    static viewType = 'mychangeImg';
    _view;
    _currentMode = 'list'; // 默认显示列表模式
    constructor(_extensionUri) {
        this._extensionUri = _extensionUri;
    }
    resolveWebviewView(webviewView, _context, _token) {
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
                cursorWorkspacePath: config.get('cursorWorkspacePath', ''),
                apiKey: config.get('apiKey', ''),
                aiModel: config.get('aiModel', 'gpt-3.5-turbo')
            };
            // 处理来自WebView的消息
            webviewView.webview.onDidReceiveMessage(async (data) => {
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
                                }
                                catch (error) {
                                    console.error('发送folderSelected消息失败:', error);
                                }
                            }
                            else {
                                console.error('_view未定义，无法发送消息');
                            }
                        }
                        else {
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
                        const cursorWorkspacePath = config.get('cursorWorkspacePath', '');
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
                        }
                        catch (error) {
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
                        const cursorWorkspacePath = config.get('cursorWorkspacePath', '');
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
                        }
                        catch (error) {
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
                        }
                        catch (error) {
                            console.error('打开目录失败:', error);
                            vscode.window.showErrorMessage(`打开目录失败: ${error instanceof Error ? error.message : '未知错误'}`);
                        }
                        break;
                    }
                    case 'exportRecords': {
                        try {
                            // 1. 获取 Cursor 工作区路径
                            const config = vscode.workspace.getConfiguration('svala');
                            const cursorWorkspacePath = config.get('cursorWorkspacePath', '');
                            if (!cursorWorkspacePath)
                                throw new Error('未设置 Cursor Workspace 路径');
                            // 2. 获取全局存储数据库路径
                            const globalDbPath = getCursorGlobalStoragePath();
                            if (!globalDbPath)
                                throw new Error('未找到 Cursor 全局存储数据库');
                            // 3. 只遍历用户勾选的 hash
                            if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
                                throw new Error('请至少勾选一个工作区');
                            }
                            const allConversations = [];
                            for (const item of data.items) {
                                const hash = item.hash;
                                const hashFolderPath = path.join(cursorWorkspacePath, hash);
                                const workspaceDbPath = findWorkspaceDb(hashFolderPath);
                                if (!workspaceDbPath)
                                    continue;
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
                                const pad = (n) => n.toString().padStart(2, '0');
                                return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
                            }
                            const fileName = `${getDateStr()}_${getRandomStr(6)}.json`;
                            // 5. 弹出保存对话框，导出为 JSON 文件
                            const os = __webpack_require__(3);
                            const pathModule = __webpack_require__(4);
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
                                    }
                                    else {
                                        vscode.window.showInformationMessage(`已成功导出选中工作区的聊天记录到 ${fileUri.fsPath}`);
                                    }
                                });
                            }
                        }
                        catch (error) {
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
                            const cursorWorkspacePath = config.get('cursorWorkspacePath', '');
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
                                const searchDbInDir = (dir, depth = 0) => {
                                    if (depth > 3)
                                        return null;
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
                                                    if (result)
                                                        return result;
                                                }
                                            }
                                            catch (e) {
                                                // 忽略权限错误等
                                            }
                                        }
                                    }
                                    catch (e) {
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
                            }
                            else {
                                // 创建并显示 Secondary Sidebar 的 Webview Panel
                                chatHistoryPanel = vscode.window.createWebviewPanel('chatHistory', // 标识符
                                `聊天记录 - ${hash.substring(0, 8)}...`, // 标题
                                vscode.ViewColumn.Beside, // 在编辑器旁边显示
                                {
                                    enableScripts: true,
                                    retainContextWhenHidden: true
                                });
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
                                                const cursorWorkspacePath = config.get('cursorWorkspacePath', '');
                                                const hashFolderPath = path.join(cursorWorkspacePath, message.hash);
                                                const globalStoragePath = getCursorGlobalStoragePath();
                                                const workspaceDbPath = findWorkspaceDb(hashFolderPath);
                                                if (!workspaceDbPath || !globalStoragePath)
                                                    throw new Error('找不到数据库');
                                                const { mainRecord, bubbles } = await getFullConversation(workspaceDbPath, globalStoragePath, message.hash, message.composerId);
                                                if (chatHistoryPanel) {
                                                    chatHistoryPanel.webview.postMessage({
                                                        type: 'chatContent',
                                                        mainRecord,
                                                        bubbles
                                                    });
                                                }
                                            }
                                            catch (e) {
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
                        }
                        catch (error) {
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
                            const cursorWorkspacePath = config.get('cursorWorkspacePath', '');
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
                                }
                                else {
                                    // 创建并显示 Secondary Sidebar 的 Webview Panel
                                    chatHistoryPanel = vscode.window.createWebviewPanel('chatHistory', // 标识符
                                    `聊天记录 - ${hash.substring(0, 8)}...`, // 标题
                                    vscode.ViewColumn.Beside, // 在编辑器旁边显示
                                    {
                                        enableScripts: true,
                                        retainContextWhenHidden: true
                                    });
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
                        }
                        catch (error) {
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
                            const cursorWorkspacePath = config.get('cursorWorkspacePath', '');
                            const hashFolderPath = path.join(cursorWorkspacePath, data.hash);
                            const globalStoragePath = getCursorGlobalStoragePath();
                            const workspaceDbPath = findWorkspaceDb(hashFolderPath);
                            if (!workspaceDbPath || !globalStoragePath)
                                throw new Error('找不到数据库');
                            const { mainRecord, bubbles } = await getFullConversation(workspaceDbPath, globalStoragePath, data.hash, data.composerId);
                            if (chatHistoryPanel) {
                                chatHistoryPanel.webview.postMessage({
                                    type: 'chatContent',
                                    mainRecord,
                                    bubbles
                                });
                            }
                        }
                        catch (e) {
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
        }
        catch (error) {
            console.error('resolveWebviewView 出错:', error);
            vscode.window.showErrorMessage(`视图初始化错误: ${error}`);
        }
    }
    // 获取工作区目录树数据
    async getWorkspaceTreeData(cursorWorkspacePath) {
        const fsPromises = fs.promises;
        const result = [];
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
                    }
                    catch (err) {
                        // 忽略没有 workspace.json 的目录或解析失败的情况
                        console.log(`子目录 ${subdir} 中没有有效的 workspace.json 文件`);
                    }
                }
            }
            return result;
        }
        catch (err) {
            console.error('获取工作区目录树数据失败:', err);
            throw new Error('指定的 Cursor Workspace 路径不存在或无法访问！');
        }
    }
    // 切换到列表模式
    switchToListMode() {
        this._currentMode = 'list';
        this._updateWebviewContent();
    }
    // 切换到设置模式
    switchToSettingMode() {
        this._currentMode = 'setting';
        this._updateWebviewContent();
    }
    // 更新WebView中的设置值
    updateSettings() {
        if (!this._view) {
            return;
        }
        // 获取当前设置
        const config = vscode.workspace.getConfiguration('svala');
        const settings = {
            type: 'updateSettings',
            cursorWorkspacePath: config.get('cursorWorkspacePath', ''),
            apiProvider: config.get('apiProvider', 'OpenAI'),
            apiBaseUrl: config.get('apiBaseUrl', 'http://localhost:11434'),
            apiKey: config.get('apiKey', ''),
            aiModel: config.get('aiModel', 'gpt-3.5-turbo')
        };
        // 发送更新消息
        this._view.webview.postMessage(settings);
    }
    async _updateWebviewContent() {
        if (!this._view) {
            console.error('_updateWebviewContent: _view未定义，无法更新WebView内容');
            return;
        }
        try {
            if (this._currentMode === 'list') {
                this._view.webview.html = this._getListHtml();
            }
            else {
                this._view.webview.html = this._getSettingsHtml();
            }
        }
        catch (error) {
            console.error('更新WebView内容时出错:', error);
        }
    }
    // 生成列表页面HTML
    _getListHtml() {
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
    _getSettingsHtml() {
        // 获取当前设置
        const config = vscode.workspace.getConfiguration('svala');
        const cursorWorkspacePath = config.get('cursorWorkspacePath', '');
        const apiProvider = config.get('apiProvider', 'OpenAI');
        const apiBaseUrl = config.get('apiBaseUrl', 'http://localhost:11434');
        const apiKey = config.get('apiKey', '');
        const aiModel = config.get('aiModel', 'gpt-3.5-turbo');
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
    _getErrorHtml(errorMessage) {
        return generateErrorHtml(errorMessage);
    }
    // 生成聊天记录页面HTML
    async _getChatHistoryHtml(hash, hashFolderPath, globalDbPath, composerId) {
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
        }
        catch (error) {
            console.error('生成聊天记录HTML失败:', error);
            return this._getErrorHtml(error instanceof Error ? error.message : '未知错误');
        }
    }
    // 生成聊天记录HTML
    _generateChatHistoryHtml(mainRecord, bubbles, allComposers, hash) {
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
						${c.title || c.composerId.substring(0, 8)}
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
    _renderChatMainHtml(mainRecord, bubbles) {
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
    triggerSelectFolder() {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'triggerSelectFolder'
            });
        }
    }
}
// 获取Cursor全局存储路径
function getCursorGlobalStoragePath() {
    try {
        // 获取用户主目录
        const homeDir = os.homedir();
        // 构建Cursor全局存储路径
        // macOS: ~/Library/Application Support/cursor/User/globalStorage
        // Windows: %APPDATA%\cursor\User\globalStorage
        // Linux: ~/.config/cursor/User/globalStorage
        let globalStoragePath;
        if (process.platform === 'darwin') {
            // macOS
            globalStoragePath = path.join(homeDir, 'Library', 'Application Support', 'cursor', 'User', 'globalStorage');
        }
        else if (process.platform === 'win32') {
            // Windows
            globalStoragePath = path.join(process.env.APPDATA || '', 'cursor', 'User', 'globalStorage');
        }
        else {
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
        }
        else {
            console.log(`Cursor全局存储路径不存在: ${globalStoragePath}`);
            return undefined;
        }
    }
    catch (error) {
        console.error('获取Cursor全局存储路径出错:', error);
        return undefined;
    }
}
// 扩展激活入口点
function activate(context) {
    console.log('Svala 扩展已激活');
    try {
        // 创建主视图提供者实例
        const mainViewProvider = new MainViewProvider(context.extensionUri);
        console.log('MainViewProvider 实例已创建');
        // 注册主视图提供者
        context.subscriptions.push(vscode.window.registerWebviewViewProvider(MainViewProvider.viewType, mainViewProvider, {
            webviewOptions: {
                retainContextWhenHidden: true // 保持上下文，避免视图重新加载
            }
        }));
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
                }, (err) => {
                    console.error('显示侧边栏失败:', err);
                    vscode.window.showErrorMessage(`显示侧边栏失败: ${err}`);
                });
            }
            catch (error) {
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
                }, (err) => {
                    console.error('显示侧边栏失败:', err);
                    vscode.window.showErrorMessage(`显示侧边栏失败: ${err}`);
                });
            }
            catch (error) {
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
            }
            catch (error) {
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
                }, (err) => {
                    console.error('显示侧边栏失败:', err);
                    vscode.window.showErrorMessage(`显示侧边栏失败: ${err}`);
                });
            }
            catch (error) {
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
            }
            catch (error) {
                console.error('svala.getViews命令执行错误:', error);
                vscode.window.showErrorMessage(`获取视图信息命令执行错误: ${error}`);
            }
        });
        context.subscriptions.push(getViewsCommand);
        console.log('svala.getViews 命令已注册');
        console.log('所有命令注册完成');
    }
    catch (error) {
        console.error('扩展激活过程中出错:', error);
        vscode.window.showErrorMessage(`扩展激活失败: ${error}`);
    }
}
// 扩展停用时的清理函数
function deactivate() {
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
function findWorkspaceDb(hashFolderPath) {
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
        const searchDbInDir = (dir, depth = 0) => {
            if (depth > 3)
                return null;
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
                            if (result)
                                return result;
                        }
                    }
                    catch (e) {
                        // 忽略权限错误等
                    }
                }
            }
            catch (e) {
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
    }
    catch (error) {
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
async function getFullConversation(workspaceDbPath, globalDbPath, hash, composerId) {
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
    }
    catch (error) {
        console.error('获取完整对话失败:', error);
        throw error;
    }
}
/**
 * 格式化消息内容，处理Markdown和代码块
 * @param content 原始消息内容
 * @returns 格式化后的HTML
 */
function formatMessageContent(content) {
    try {
        // 使用marked库处理Markdown，使用同步模式
        const options = { async: false };
        // 强制类型转换为字符串，因为我们使用了同步模式
        return marked.parse(content, options);
    }
    catch (error) {
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
function generateErrorHtml(errorMessage) {
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


/***/ }),
/* 1 */
/***/ ((module) => {

module.exports = require("vscode");

/***/ }),
/* 2 */
/***/ ((module) => {

module.exports = require("fs");

/***/ }),
/* 3 */
/***/ ((module) => {

module.exports = require("os");

/***/ }),
/* 4 */
/***/ ((module) => {

module.exports = require("path");

/***/ }),
/* 5 */
/***/ ((module) => {

module.exports = require("@vscode/sqlite3");

/***/ }),
/* 6 */
/***/ ((__unused_webpack_module, exports) => {

/**
 * marked v15.0.11 - a markdown parser
 * Copyright (c) 2011-2025, Christopher Jeffrey. (MIT Licensed)
 * https://github.com/markedjs/marked
 */

/**
 * DO NOT EDIT THIS FILE
 * The code in this file is generated from files in ./src/
 */



/**
 * Gets the original marked default options.
 */
function _getDefaults() {
    return {
        async: false,
        breaks: false,
        extensions: null,
        gfm: true,
        hooks: null,
        pedantic: false,
        renderer: null,
        silent: false,
        tokenizer: null,
        walkTokens: null,
    };
}
exports.defaults = _getDefaults();
function changeDefaults(newDefaults) {
    exports.defaults = newDefaults;
}

const noopTest = { exec: () => null };
function edit(regex, opt = '') {
    let source = typeof regex === 'string' ? regex : regex.source;
    const obj = {
        replace: (name, val) => {
            let valSource = typeof val === 'string' ? val : val.source;
            valSource = valSource.replace(other.caret, '$1');
            source = source.replace(name, valSource);
            return obj;
        },
        getRegex: () => {
            return new RegExp(source, opt);
        },
    };
    return obj;
}
const other = {
    codeRemoveIndent: /^(?: {1,4}| {0,3}\t)/gm,
    outputLinkReplace: /\\([\[\]])/g,
    indentCodeCompensation: /^(\s+)(?:```)/,
    beginningSpace: /^\s+/,
    endingHash: /#$/,
    startingSpaceChar: /^ /,
    endingSpaceChar: / $/,
    nonSpaceChar: /[^ ]/,
    newLineCharGlobal: /\n/g,
    tabCharGlobal: /\t/g,
    multipleSpaceGlobal: /\s+/g,
    blankLine: /^[ \t]*$/,
    doubleBlankLine: /\n[ \t]*\n[ \t]*$/,
    blockquoteStart: /^ {0,3}>/,
    blockquoteSetextReplace: /\n {0,3}((?:=+|-+) *)(?=\n|$)/g,
    blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm,
    listReplaceTabs: /^\t+/,
    listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g,
    listIsTask: /^\[[ xX]\] /,
    listReplaceTask: /^\[[ xX]\] +/,
    anyLine: /\n.*\n/,
    hrefBrackets: /^<(.*)>$/,
    tableDelimiter: /[:|]/,
    tableAlignChars: /^\||\| *$/g,
    tableRowBlankLine: /\n[ \t]*$/,
    tableAlignRight: /^ *-+: *$/,
    tableAlignCenter: /^ *:-+: *$/,
    tableAlignLeft: /^ *:-+ *$/,
    startATag: /^<a /i,
    endATag: /^<\/a>/i,
    startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i,
    endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i,
    startAngleBracket: /^</,
    endAngleBracket: />$/,
    pedanticHrefTitle: /^([^'"]*[^\s])\s+(['"])(.*)\2/,
    unicodeAlphaNumeric: /[\p{L}\p{N}]/u,
    escapeTest: /[&<>"']/,
    escapeReplace: /[&<>"']/g,
    escapeTestNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,
    escapeReplaceNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,
    unescapeTest: /&(#(?:\d+)|(?:#x[0-9A-Fa-f]+)|(?:\w+));?/ig,
    caret: /(^|[^\[])\^/g,
    percentDecode: /%25/g,
    findPipe: /\|/g,
    splitPipe: / \|/,
    slashPipe: /\\\|/g,
    carriageReturn: /\r\n|\r/g,
    spaceLine: /^ +$/gm,
    notSpaceStart: /^\S*/,
    endingNewline: /\n$/,
    listItemRegex: (bull) => new RegExp(`^( {0,3}${bull})((?:[\t ][^\\n]*)?(?:\\n|$))`),
    nextBulletRegex: (indent) => new RegExp(`^ {0,${Math.min(3, indent - 1)}}(?:[*+-]|\\d{1,9}[.)])((?:[ \t][^\\n]*)?(?:\\n|$))`),
    hrRegex: (indent) => new RegExp(`^ {0,${Math.min(3, indent - 1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`),
    fencesBeginRegex: (indent) => new RegExp(`^ {0,${Math.min(3, indent - 1)}}(?:\`\`\`|~~~)`),
    headingBeginRegex: (indent) => new RegExp(`^ {0,${Math.min(3, indent - 1)}}#`),
    htmlBeginRegex: (indent) => new RegExp(`^ {0,${Math.min(3, indent - 1)}}<(?:[a-z].*>|!--)`, 'i'),
};
/**
 * Block-Level Grammar
 */
const newline = /^(?:[ \t]*(?:\n|$))+/;
const blockCode = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
const fences = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/;
const hr = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
const heading = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
const bullet = /(?:[*+-]|\d{1,9}[.)])/;
const lheadingCore = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/;
const lheading = edit(lheadingCore)
    .replace(/bull/g, bullet) // lists can interrupt
    .replace(/blockCode/g, /(?: {4}| {0,3}\t)/) // indented code blocks can interrupt
    .replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/) // fenced code blocks can interrupt
    .replace(/blockquote/g, / {0,3}>/) // blockquote can interrupt
    .replace(/heading/g, / {0,3}#{1,6}/) // ATX heading can interrupt
    .replace(/html/g, / {0,3}<[^\n>]+>\n/) // block html can interrupt
    .replace(/\|table/g, '') // table not in commonmark
    .getRegex();
const lheadingGfm = edit(lheadingCore)
    .replace(/bull/g, bullet) // lists can interrupt
    .replace(/blockCode/g, /(?: {4}| {0,3}\t)/) // indented code blocks can interrupt
    .replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/) // fenced code blocks can interrupt
    .replace(/blockquote/g, / {0,3}>/) // blockquote can interrupt
    .replace(/heading/g, / {0,3}#{1,6}/) // ATX heading can interrupt
    .replace(/html/g, / {0,3}<[^\n>]+>\n/) // block html can interrupt
    .replace(/table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/) // table can interrupt
    .getRegex();
const _paragraph = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/;
const blockText = /^[^\n]+/;
const _blockLabel = /(?!\s*\])(?:\\.|[^\[\]\\])+/;
const def = edit(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/)
    .replace('label', _blockLabel)
    .replace('title', /(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/)
    .getRegex();
const list = edit(/^( {0,3}bull)([ \t][^\n]+?)?(?:\n|$)/)
    .replace(/bull/g, bullet)
    .getRegex();
const _tag = 'address|article|aside|base|basefont|blockquote|body|caption'
    + '|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption'
    + '|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe'
    + '|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option'
    + '|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title'
    + '|tr|track|ul';
const _comment = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
const html = edit('^ {0,3}(?:' // optional indentation
    + '<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)' // (1)
    + '|comment[^\\n]*(\\n+|$)' // (2)
    + '|<\\?[\\s\\S]*?(?:\\?>\\n*|$)' // (3)
    + '|<![A-Z][\\s\\S]*?(?:>\\n*|$)' // (4)
    + '|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)' // (5)
    + '|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)' // (6)
    + '|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)' // (7) open tag
    + '|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)' // (7) closing tag
    + ')', 'i')
    .replace('comment', _comment)
    .replace('tag', _tag)
    .replace('attribute', / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/)
    .getRegex();
const paragraph = edit(_paragraph)
    .replace('hr', hr)
    .replace('heading', ' {0,3}#{1,6}(?:\\s|$)')
    .replace('|lheading', '') // setext headings don't interrupt commonmark paragraphs
    .replace('|table', '')
    .replace('blockquote', ' {0,3}>')
    .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n')
    .replace('list', ' {0,3}(?:[*+-]|1[.)]) ') // only lists starting from 1 can interrupt
    .replace('html', '</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)')
    .replace('tag', _tag) // pars can be interrupted by type (6) html blocks
    .getRegex();
const blockquote = edit(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/)
    .replace('paragraph', paragraph)
    .getRegex();
/**
 * Normal Block Grammar
 */
const blockNormal = {
    blockquote,
    code: blockCode,
    def,
    fences,
    heading,
    hr,
    html,
    lheading,
    list,
    newline,
    paragraph,
    table: noopTest,
    text: blockText,
};
/**
 * GFM Block Grammar
 */
const gfmTable = edit('^ *([^\\n ].*)\\n' // Header
    + ' {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)' // Align
    + '(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)') // Cells
    .replace('hr', hr)
    .replace('heading', ' {0,3}#{1,6}(?:\\s|$)')
    .replace('blockquote', ' {0,3}>')
    .replace('code', '(?: {4}| {0,3}\t)[^\\n]')
    .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n')
    .replace('list', ' {0,3}(?:[*+-]|1[.)]) ') // only lists starting from 1 can interrupt
    .replace('html', '</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)')
    .replace('tag', _tag) // tables can be interrupted by type (6) html blocks
    .getRegex();
const blockGfm = {
    ...blockNormal,
    lheading: lheadingGfm,
    table: gfmTable,
    paragraph: edit(_paragraph)
        .replace('hr', hr)
        .replace('heading', ' {0,3}#{1,6}(?:\\s|$)')
        .replace('|lheading', '') // setext headings don't interrupt commonmark paragraphs
        .replace('table', gfmTable) // interrupt paragraphs with table
        .replace('blockquote', ' {0,3}>')
        .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n')
        .replace('list', ' {0,3}(?:[*+-]|1[.)]) ') // only lists starting from 1 can interrupt
        .replace('html', '</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)')
        .replace('tag', _tag) // pars can be interrupted by type (6) html blocks
        .getRegex(),
};
/**
 * Pedantic grammar (original John Gruber's loose markdown specification)
 */
const blockPedantic = {
    ...blockNormal,
    html: edit('^ *(?:comment *(?:\\n|\\s*$)'
        + '|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)' // closed tag
        + '|<tag(?:"[^"]*"|\'[^\']*\'|\\s[^\'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))')
        .replace('comment', _comment)
        .replace(/tag/g, '(?!(?:'
        + 'a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub'
        + '|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)'
        + '\\b)\\w+(?!:|[^\\w\\s@]*@)\\b')
        .getRegex(),
    def: /^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,
    heading: /^(#{1,6})(.*)(?:\n+|$)/,
    fences: noopTest, // fences not supported
    lheading: /^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,
    paragraph: edit(_paragraph)
        .replace('hr', hr)
        .replace('heading', ' *#{1,6} *[^\n]')
        .replace('lheading', lheading)
        .replace('|table', '')
        .replace('blockquote', ' {0,3}>')
        .replace('|fences', '')
        .replace('|list', '')
        .replace('|html', '')
        .replace('|tag', '')
        .getRegex(),
};
/**
 * Inline-Level Grammar
 */
const escape$1 = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
const inlineCode = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
const br = /^( {2,}|\\)\n(?!\s*$)/;
const inlineText = /^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/;
// list of unicode punctuation marks, plus any missing characters from CommonMark spec
const _punctuation = /[\p{P}\p{S}]/u;
const _punctuationOrSpace = /[\s\p{P}\p{S}]/u;
const _notPunctuationOrSpace = /[^\s\p{P}\p{S}]/u;
const punctuation = edit(/^((?![*_])punctSpace)/, 'u')
    .replace(/punctSpace/g, _punctuationOrSpace).getRegex();
// GFM allows ~ inside strong and em for strikethrough
const _punctuationGfmStrongEm = /(?!~)[\p{P}\p{S}]/u;
const _punctuationOrSpaceGfmStrongEm = /(?!~)[\s\p{P}\p{S}]/u;
const _notPunctuationOrSpaceGfmStrongEm = /(?:[^\s\p{P}\p{S}]|~)/u;
// sequences em should skip over [title](link), `code`, <html>
const blockSkip = /\[[^[\]]*?\]\((?:\\.|[^\\\(\)]|\((?:\\.|[^\\\(\)])*\))*\)|`[^`]*?`|<[^<>]*?>/g;
const emStrongLDelimCore = /^(?:\*+(?:((?!\*)punct)|[^\s*]))|^_+(?:((?!_)punct)|([^\s_]))/;
const emStrongLDelim = edit(emStrongLDelimCore, 'u')
    .replace(/punct/g, _punctuation)
    .getRegex();
const emStrongLDelimGfm = edit(emStrongLDelimCore, 'u')
    .replace(/punct/g, _punctuationGfmStrongEm)
    .getRegex();
const emStrongRDelimAstCore = '^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)' // Skip orphan inside strong
    + '|[^*]+(?=[^*])' // Consume to delim
    + '|(?!\\*)punct(\\*+)(?=[\\s]|$)' // (1) #*** can only be a Right Delimiter
    + '|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)' // (2) a***#, a*** can only be a Right Delimiter
    + '|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)' // (3) #***a, ***a can only be Left Delimiter
    + '|[\\s](\\*+)(?!\\*)(?=punct)' // (4) ***# can only be Left Delimiter
    + '|(?!\\*)punct(\\*+)(?!\\*)(?=punct)' // (5) #***# can be either Left or Right Delimiter
    + '|notPunctSpace(\\*+)(?=notPunctSpace)'; // (6) a***a can be either Left or Right Delimiter
const emStrongRDelimAst = edit(emStrongRDelimAstCore, 'gu')
    .replace(/notPunctSpace/g, _notPunctuationOrSpace)
    .replace(/punctSpace/g, _punctuationOrSpace)
    .replace(/punct/g, _punctuation)
    .getRegex();
const emStrongRDelimAstGfm = edit(emStrongRDelimAstCore, 'gu')
    .replace(/notPunctSpace/g, _notPunctuationOrSpaceGfmStrongEm)
    .replace(/punctSpace/g, _punctuationOrSpaceGfmStrongEm)
    .replace(/punct/g, _punctuationGfmStrongEm)
    .getRegex();
// (6) Not allowed for _
const emStrongRDelimUnd = edit('^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)' // Skip orphan inside strong
    + '|[^_]+(?=[^_])' // Consume to delim
    + '|(?!_)punct(_+)(?=[\\s]|$)' // (1) #___ can only be a Right Delimiter
    + '|notPunctSpace(_+)(?!_)(?=punctSpace|$)' // (2) a___#, a___ can only be a Right Delimiter
    + '|(?!_)punctSpace(_+)(?=notPunctSpace)' // (3) #___a, ___a can only be Left Delimiter
    + '|[\\s](_+)(?!_)(?=punct)' // (4) ___# can only be Left Delimiter
    + '|(?!_)punct(_+)(?!_)(?=punct)', 'gu') // (5) #___# can be either Left or Right Delimiter
    .replace(/notPunctSpace/g, _notPunctuationOrSpace)
    .replace(/punctSpace/g, _punctuationOrSpace)
    .replace(/punct/g, _punctuation)
    .getRegex();
const anyPunctuation = edit(/\\(punct)/, 'gu')
    .replace(/punct/g, _punctuation)
    .getRegex();
const autolink = edit(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/)
    .replace('scheme', /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/)
    .replace('email', /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/)
    .getRegex();
const _inlineComment = edit(_comment).replace('(?:-->|$)', '-->').getRegex();
const tag = edit('^comment'
    + '|^</[a-zA-Z][\\w:-]*\\s*>' // self-closing tag
    + '|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>' // open tag
    + '|^<\\?[\\s\\S]*?\\?>' // processing instruction, e.g. <?php ?>
    + '|^<![a-zA-Z]+\\s[\\s\\S]*?>' // declaration, e.g. <!DOCTYPE html>
    + '|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>') // CDATA section
    .replace('comment', _inlineComment)
    .replace('attribute', /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/)
    .getRegex();
const _inlineLabel = /(?:\[(?:\\.|[^\[\]\\])*\]|\\.|`[^`]*`|[^\[\]\\`])*?/;
const link = edit(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]*(?:\n[ \t]*)?)(title))?\s*\)/)
    .replace('label', _inlineLabel)
    .replace('href', /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]*/)
    .replace('title', /"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/)
    .getRegex();
const reflink = edit(/^!?\[(label)\]\[(ref)\]/)
    .replace('label', _inlineLabel)
    .replace('ref', _blockLabel)
    .getRegex();
const nolink = edit(/^!?\[(ref)\](?:\[\])?/)
    .replace('ref', _blockLabel)
    .getRegex();
const reflinkSearch = edit('reflink|nolink(?!\\()', 'g')
    .replace('reflink', reflink)
    .replace('nolink', nolink)
    .getRegex();
/**
 * Normal Inline Grammar
 */
const inlineNormal = {
    _backpedal: noopTest, // only used for GFM url
    anyPunctuation,
    autolink,
    blockSkip,
    br,
    code: inlineCode,
    del: noopTest,
    emStrongLDelim,
    emStrongRDelimAst,
    emStrongRDelimUnd,
    escape: escape$1,
    link,
    nolink,
    punctuation,
    reflink,
    reflinkSearch,
    tag,
    text: inlineText,
    url: noopTest,
};
/**
 * Pedantic Inline Grammar
 */
const inlinePedantic = {
    ...inlineNormal,
    link: edit(/^!?\[(label)\]\((.*?)\)/)
        .replace('label', _inlineLabel)
        .getRegex(),
    reflink: edit(/^!?\[(label)\]\s*\[([^\]]*)\]/)
        .replace('label', _inlineLabel)
        .getRegex(),
};
/**
 * GFM Inline Grammar
 */
const inlineGfm = {
    ...inlineNormal,
    emStrongRDelimAst: emStrongRDelimAstGfm,
    emStrongLDelim: emStrongLDelimGfm,
    url: edit(/^((?:ftp|https?):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/, 'i')
        .replace('email', /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/)
        .getRegex(),
    _backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,
    del: /^(~~?)(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))\1(?=[^~]|$)/,
    text: /^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|https?:\/\/|ftp:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/,
};
/**
 * GFM + Line Breaks Inline Grammar
 */
const inlineBreaks = {
    ...inlineGfm,
    br: edit(br).replace('{2,}', '*').getRegex(),
    text: edit(inlineGfm.text)
        .replace('\\b_', '\\b_| {2,}\\n')
        .replace(/\{2,\}/g, '*')
        .getRegex(),
};
/**
 * exports
 */
const block = {
    normal: blockNormal,
    gfm: blockGfm,
    pedantic: blockPedantic,
};
const inline = {
    normal: inlineNormal,
    gfm: inlineGfm,
    breaks: inlineBreaks,
    pedantic: inlinePedantic,
};

/**
 * Helpers
 */
const escapeReplacements = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};
const getEscapeReplacement = (ch) => escapeReplacements[ch];
function escape(html, encode) {
    if (encode) {
        if (other.escapeTest.test(html)) {
            return html.replace(other.escapeReplace, getEscapeReplacement);
        }
    }
    else {
        if (other.escapeTestNoEncode.test(html)) {
            return html.replace(other.escapeReplaceNoEncode, getEscapeReplacement);
        }
    }
    return html;
}
function cleanUrl(href) {
    try {
        href = encodeURI(href).replace(other.percentDecode, '%');
    }
    catch {
        return null;
    }
    return href;
}
function splitCells(tableRow, count) {
    // ensure that every cell-delimiting pipe has a space
    // before it to distinguish it from an escaped pipe
    const row = tableRow.replace(other.findPipe, (match, offset, str) => {
        let escaped = false;
        let curr = offset;
        while (--curr >= 0 && str[curr] === '\\')
            escaped = !escaped;
        if (escaped) {
            // odd number of slashes means | is escaped
            // so we leave it alone
            return '|';
        }
        else {
            // add space before unescaped |
            return ' |';
        }
    }), cells = row.split(other.splitPipe);
    let i = 0;
    // First/last cell in a row cannot be empty if it has no leading/trailing pipe
    if (!cells[0].trim()) {
        cells.shift();
    }
    if (cells.length > 0 && !cells.at(-1)?.trim()) {
        cells.pop();
    }
    if (count) {
        if (cells.length > count) {
            cells.splice(count);
        }
        else {
            while (cells.length < count)
                cells.push('');
        }
    }
    for (; i < cells.length; i++) {
        // leading or trailing whitespace is ignored per the gfm spec
        cells[i] = cells[i].trim().replace(other.slashPipe, '|');
    }
    return cells;
}
/**
 * Remove trailing 'c's. Equivalent to str.replace(/c*$/, '').
 * /c*$/ is vulnerable to REDOS.
 *
 * @param str
 * @param c
 * @param invert Remove suffix of non-c chars instead. Default falsey.
 */
function rtrim(str, c, invert) {
    const l = str.length;
    if (l === 0) {
        return '';
    }
    // Length of suffix matching the invert condition.
    let suffLen = 0;
    // Step left until we fail to match the invert condition.
    while (suffLen < l) {
        const currChar = str.charAt(l - suffLen - 1);
        if (currChar === c && true) {
            suffLen++;
        }
        else {
            break;
        }
    }
    return str.slice(0, l - suffLen);
}
function findClosingBracket(str, b) {
    if (str.indexOf(b[1]) === -1) {
        return -1;
    }
    let level = 0;
    for (let i = 0; i < str.length; i++) {
        if (str[i] === '\\') {
            i++;
        }
        else if (str[i] === b[0]) {
            level++;
        }
        else if (str[i] === b[1]) {
            level--;
            if (level < 0) {
                return i;
            }
        }
    }
    if (level > 0) {
        return -2;
    }
    return -1;
}

function outputLink(cap, link, raw, lexer, rules) {
    const href = link.href;
    const title = link.title || null;
    const text = cap[1].replace(rules.other.outputLinkReplace, '$1');
    lexer.state.inLink = true;
    const token = {
        type: cap[0].charAt(0) === '!' ? 'image' : 'link',
        raw,
        href,
        title,
        text,
        tokens: lexer.inlineTokens(text),
    };
    lexer.state.inLink = false;
    return token;
}
function indentCodeCompensation(raw, text, rules) {
    const matchIndentToCode = raw.match(rules.other.indentCodeCompensation);
    if (matchIndentToCode === null) {
        return text;
    }
    const indentToCode = matchIndentToCode[1];
    return text
        .split('\n')
        .map(node => {
        const matchIndentInNode = node.match(rules.other.beginningSpace);
        if (matchIndentInNode === null) {
            return node;
        }
        const [indentInNode] = matchIndentInNode;
        if (indentInNode.length >= indentToCode.length) {
            return node.slice(indentToCode.length);
        }
        return node;
    })
        .join('\n');
}
/**
 * Tokenizer
 */
class _Tokenizer {
    options;
    rules; // set by the lexer
    lexer; // set by the lexer
    constructor(options) {
        this.options = options || exports.defaults;
    }
    space(src) {
        const cap = this.rules.block.newline.exec(src);
        if (cap && cap[0].length > 0) {
            return {
                type: 'space',
                raw: cap[0],
            };
        }
    }
    code(src) {
        const cap = this.rules.block.code.exec(src);
        if (cap) {
            const text = cap[0].replace(this.rules.other.codeRemoveIndent, '');
            return {
                type: 'code',
                raw: cap[0],
                codeBlockStyle: 'indented',
                text: !this.options.pedantic
                    ? rtrim(text, '\n')
                    : text,
            };
        }
    }
    fences(src) {
        const cap = this.rules.block.fences.exec(src);
        if (cap) {
            const raw = cap[0];
            const text = indentCodeCompensation(raw, cap[3] || '', this.rules);
            return {
                type: 'code',
                raw,
                lang: cap[2] ? cap[2].trim().replace(this.rules.inline.anyPunctuation, '$1') : cap[2],
                text,
            };
        }
    }
    heading(src) {
        const cap = this.rules.block.heading.exec(src);
        if (cap) {
            let text = cap[2].trim();
            // remove trailing #s
            if (this.rules.other.endingHash.test(text)) {
                const trimmed = rtrim(text, '#');
                if (this.options.pedantic) {
                    text = trimmed.trim();
                }
                else if (!trimmed || this.rules.other.endingSpaceChar.test(trimmed)) {
                    // CommonMark requires space before trailing #s
                    text = trimmed.trim();
                }
            }
            return {
                type: 'heading',
                raw: cap[0],
                depth: cap[1].length,
                text,
                tokens: this.lexer.inline(text),
            };
        }
    }
    hr(src) {
        const cap = this.rules.block.hr.exec(src);
        if (cap) {
            return {
                type: 'hr',
                raw: rtrim(cap[0], '\n'),
            };
        }
    }
    blockquote(src) {
        const cap = this.rules.block.blockquote.exec(src);
        if (cap) {
            let lines = rtrim(cap[0], '\n').split('\n');
            let raw = '';
            let text = '';
            const tokens = [];
            while (lines.length > 0) {
                let inBlockquote = false;
                const currentLines = [];
                let i;
                for (i = 0; i < lines.length; i++) {
                    // get lines up to a continuation
                    if (this.rules.other.blockquoteStart.test(lines[i])) {
                        currentLines.push(lines[i]);
                        inBlockquote = true;
                    }
                    else if (!inBlockquote) {
                        currentLines.push(lines[i]);
                    }
                    else {
                        break;
                    }
                }
                lines = lines.slice(i);
                const currentRaw = currentLines.join('\n');
                const currentText = currentRaw
                    // precede setext continuation with 4 spaces so it isn't a setext
                    .replace(this.rules.other.blockquoteSetextReplace, '\n    $1')
                    .replace(this.rules.other.blockquoteSetextReplace2, '');
                raw = raw ? `${raw}\n${currentRaw}` : currentRaw;
                text = text ? `${text}\n${currentText}` : currentText;
                // parse blockquote lines as top level tokens
                // merge paragraphs if this is a continuation
                const top = this.lexer.state.top;
                this.lexer.state.top = true;
                this.lexer.blockTokens(currentText, tokens, true);
                this.lexer.state.top = top;
                // if there is no continuation then we are done
                if (lines.length === 0) {
                    break;
                }
                const lastToken = tokens.at(-1);
                if (lastToken?.type === 'code') {
                    // blockquote continuation cannot be preceded by a code block
                    break;
                }
                else if (lastToken?.type === 'blockquote') {
                    // include continuation in nested blockquote
                    const oldToken = lastToken;
                    const newText = oldToken.raw + '\n' + lines.join('\n');
                    const newToken = this.blockquote(newText);
                    tokens[tokens.length - 1] = newToken;
                    raw = raw.substring(0, raw.length - oldToken.raw.length) + newToken.raw;
                    text = text.substring(0, text.length - oldToken.text.length) + newToken.text;
                    break;
                }
                else if (lastToken?.type === 'list') {
                    // include continuation in nested list
                    const oldToken = lastToken;
                    const newText = oldToken.raw + '\n' + lines.join('\n');
                    const newToken = this.list(newText);
                    tokens[tokens.length - 1] = newToken;
                    raw = raw.substring(0, raw.length - lastToken.raw.length) + newToken.raw;
                    text = text.substring(0, text.length - oldToken.raw.length) + newToken.raw;
                    lines = newText.substring(tokens.at(-1).raw.length).split('\n');
                    continue;
                }
            }
            return {
                type: 'blockquote',
                raw,
                tokens,
                text,
            };
        }
    }
    list(src) {
        let cap = this.rules.block.list.exec(src);
        if (cap) {
            let bull = cap[1].trim();
            const isordered = bull.length > 1;
            const list = {
                type: 'list',
                raw: '',
                ordered: isordered,
                start: isordered ? +bull.slice(0, -1) : '',
                loose: false,
                items: [],
            };
            bull = isordered ? `\\d{1,9}\\${bull.slice(-1)}` : `\\${bull}`;
            if (this.options.pedantic) {
                bull = isordered ? bull : '[*+-]';
            }
            // Get next list item
            const itemRegex = this.rules.other.listItemRegex(bull);
            let endsWithBlankLine = false;
            // Check if current bullet point can start a new List Item
            while (src) {
                let endEarly = false;
                let raw = '';
                let itemContents = '';
                if (!(cap = itemRegex.exec(src))) {
                    break;
                }
                if (this.rules.block.hr.test(src)) { // End list if bullet was actually HR (possibly move into itemRegex?)
                    break;
                }
                raw = cap[0];
                src = src.substring(raw.length);
                let line = cap[2].split('\n', 1)[0].replace(this.rules.other.listReplaceTabs, (t) => ' '.repeat(3 * t.length));
                let nextLine = src.split('\n', 1)[0];
                let blankLine = !line.trim();
                let indent = 0;
                if (this.options.pedantic) {
                    indent = 2;
                    itemContents = line.trimStart();
                }
                else if (blankLine) {
                    indent = cap[1].length + 1;
                }
                else {
                    indent = cap[2].search(this.rules.other.nonSpaceChar); // Find first non-space char
                    indent = indent > 4 ? 1 : indent; // Treat indented code blocks (> 4 spaces) as having only 1 indent
                    itemContents = line.slice(indent);
                    indent += cap[1].length;
                }
                if (blankLine && this.rules.other.blankLine.test(nextLine)) { // Items begin with at most one blank line
                    raw += nextLine + '\n';
                    src = src.substring(nextLine.length + 1);
                    endEarly = true;
                }
                if (!endEarly) {
                    const nextBulletRegex = this.rules.other.nextBulletRegex(indent);
                    const hrRegex = this.rules.other.hrRegex(indent);
                    const fencesBeginRegex = this.rules.other.fencesBeginRegex(indent);
                    const headingBeginRegex = this.rules.other.headingBeginRegex(indent);
                    const htmlBeginRegex = this.rules.other.htmlBeginRegex(indent);
                    // Check if following lines should be included in List Item
                    while (src) {
                        const rawLine = src.split('\n', 1)[0];
                        let nextLineWithoutTabs;
                        nextLine = rawLine;
                        // Re-align to follow commonmark nesting rules
                        if (this.options.pedantic) {
                            nextLine = nextLine.replace(this.rules.other.listReplaceNesting, '  ');
                            nextLineWithoutTabs = nextLine;
                        }
                        else {
                            nextLineWithoutTabs = nextLine.replace(this.rules.other.tabCharGlobal, '    ');
                        }
                        // End list item if found code fences
                        if (fencesBeginRegex.test(nextLine)) {
                            break;
                        }
                        // End list item if found start of new heading
                        if (headingBeginRegex.test(nextLine)) {
                            break;
                        }
                        // End list item if found start of html block
                        if (htmlBeginRegex.test(nextLine)) {
                            break;
                        }
                        // End list item if found start of new bullet
                        if (nextBulletRegex.test(nextLine)) {
                            break;
                        }
                        // Horizontal rule found
                        if (hrRegex.test(nextLine)) {
                            break;
                        }
                        if (nextLineWithoutTabs.search(this.rules.other.nonSpaceChar) >= indent || !nextLine.trim()) { // Dedent if possible
                            itemContents += '\n' + nextLineWithoutTabs.slice(indent);
                        }
                        else {
                            // not enough indentation
                            if (blankLine) {
                                break;
                            }
                            // paragraph continuation unless last line was a different block level element
                            if (line.replace(this.rules.other.tabCharGlobal, '    ').search(this.rules.other.nonSpaceChar) >= 4) { // indented code block
                                break;
                            }
                            if (fencesBeginRegex.test(line)) {
                                break;
                            }
                            if (headingBeginRegex.test(line)) {
                                break;
                            }
                            if (hrRegex.test(line)) {
                                break;
                            }
                            itemContents += '\n' + nextLine;
                        }
                        if (!blankLine && !nextLine.trim()) { // Check if current line is blank
                            blankLine = true;
                        }
                        raw += rawLine + '\n';
                        src = src.substring(rawLine.length + 1);
                        line = nextLineWithoutTabs.slice(indent);
                    }
                }
                if (!list.loose) {
                    // If the previous item ended with a blank line, the list is loose
                    if (endsWithBlankLine) {
                        list.loose = true;
                    }
                    else if (this.rules.other.doubleBlankLine.test(raw)) {
                        endsWithBlankLine = true;
                    }
                }
                let istask = null;
                let ischecked;
                // Check for task list items
                if (this.options.gfm) {
                    istask = this.rules.other.listIsTask.exec(itemContents);
                    if (istask) {
                        ischecked = istask[0] !== '[ ] ';
                        itemContents = itemContents.replace(this.rules.other.listReplaceTask, '');
                    }
                }
                list.items.push({
                    type: 'list_item',
                    raw,
                    task: !!istask,
                    checked: ischecked,
                    loose: false,
                    text: itemContents,
                    tokens: [],
                });
                list.raw += raw;
            }
            // Do not consume newlines at end of final item. Alternatively, make itemRegex *start* with any newlines to simplify/speed up endsWithBlankLine logic
            const lastItem = list.items.at(-1);
            if (lastItem) {
                lastItem.raw = lastItem.raw.trimEnd();
                lastItem.text = lastItem.text.trimEnd();
            }
            else {
                // not a list since there were no items
                return;
            }
            list.raw = list.raw.trimEnd();
            // Item child tokens handled here at end because we needed to have the final item to trim it first
            for (let i = 0; i < list.items.length; i++) {
                this.lexer.state.top = false;
                list.items[i].tokens = this.lexer.blockTokens(list.items[i].text, []);
                if (!list.loose) {
                    // Check if list should be loose
                    const spacers = list.items[i].tokens.filter(t => t.type === 'space');
                    const hasMultipleLineBreaks = spacers.length > 0 && spacers.some(t => this.rules.other.anyLine.test(t.raw));
                    list.loose = hasMultipleLineBreaks;
                }
            }
            // Set all items to loose if list is loose
            if (list.loose) {
                for (let i = 0; i < list.items.length; i++) {
                    list.items[i].loose = true;
                }
            }
            return list;
        }
    }
    html(src) {
        const cap = this.rules.block.html.exec(src);
        if (cap) {
            const token = {
                type: 'html',
                block: true,
                raw: cap[0],
                pre: cap[1] === 'pre' || cap[1] === 'script' || cap[1] === 'style',
                text: cap[0],
            };
            return token;
        }
    }
    def(src) {
        const cap = this.rules.block.def.exec(src);
        if (cap) {
            const tag = cap[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal, ' ');
            const href = cap[2] ? cap[2].replace(this.rules.other.hrefBrackets, '$1').replace(this.rules.inline.anyPunctuation, '$1') : '';
            const title = cap[3] ? cap[3].substring(1, cap[3].length - 1).replace(this.rules.inline.anyPunctuation, '$1') : cap[3];
            return {
                type: 'def',
                tag,
                raw: cap[0],
                href,
                title,
            };
        }
    }
    table(src) {
        const cap = this.rules.block.table.exec(src);
        if (!cap) {
            return;
        }
        if (!this.rules.other.tableDelimiter.test(cap[2])) {
            // delimiter row must have a pipe (|) or colon (:) otherwise it is a setext heading
            return;
        }
        const headers = splitCells(cap[1]);
        const aligns = cap[2].replace(this.rules.other.tableAlignChars, '').split('|');
        const rows = cap[3]?.trim() ? cap[3].replace(this.rules.other.tableRowBlankLine, '').split('\n') : [];
        const item = {
            type: 'table',
            raw: cap[0],
            header: [],
            align: [],
            rows: [],
        };
        if (headers.length !== aligns.length) {
            // header and align columns must be equal, rows can be different.
            return;
        }
        for (const align of aligns) {
            if (this.rules.other.tableAlignRight.test(align)) {
                item.align.push('right');
            }
            else if (this.rules.other.tableAlignCenter.test(align)) {
                item.align.push('center');
            }
            else if (this.rules.other.tableAlignLeft.test(align)) {
                item.align.push('left');
            }
            else {
                item.align.push(null);
            }
        }
        for (let i = 0; i < headers.length; i++) {
            item.header.push({
                text: headers[i],
                tokens: this.lexer.inline(headers[i]),
                header: true,
                align: item.align[i],
            });
        }
        for (const row of rows) {
            item.rows.push(splitCells(row, item.header.length).map((cell, i) => {
                return {
                    text: cell,
                    tokens: this.lexer.inline(cell),
                    header: false,
                    align: item.align[i],
                };
            }));
        }
        return item;
    }
    lheading(src) {
        const cap = this.rules.block.lheading.exec(src);
        if (cap) {
            return {
                type: 'heading',
                raw: cap[0],
                depth: cap[2].charAt(0) === '=' ? 1 : 2,
                text: cap[1],
                tokens: this.lexer.inline(cap[1]),
            };
        }
    }
    paragraph(src) {
        const cap = this.rules.block.paragraph.exec(src);
        if (cap) {
            const text = cap[1].charAt(cap[1].length - 1) === '\n'
                ? cap[1].slice(0, -1)
                : cap[1];
            return {
                type: 'paragraph',
                raw: cap[0],
                text,
                tokens: this.lexer.inline(text),
            };
        }
    }
    text(src) {
        const cap = this.rules.block.text.exec(src);
        if (cap) {
            return {
                type: 'text',
                raw: cap[0],
                text: cap[0],
                tokens: this.lexer.inline(cap[0]),
            };
        }
    }
    escape(src) {
        const cap = this.rules.inline.escape.exec(src);
        if (cap) {
            return {
                type: 'escape',
                raw: cap[0],
                text: cap[1],
            };
        }
    }
    tag(src) {
        const cap = this.rules.inline.tag.exec(src);
        if (cap) {
            if (!this.lexer.state.inLink && this.rules.other.startATag.test(cap[0])) {
                this.lexer.state.inLink = true;
            }
            else if (this.lexer.state.inLink && this.rules.other.endATag.test(cap[0])) {
                this.lexer.state.inLink = false;
            }
            if (!this.lexer.state.inRawBlock && this.rules.other.startPreScriptTag.test(cap[0])) {
                this.lexer.state.inRawBlock = true;
            }
            else if (this.lexer.state.inRawBlock && this.rules.other.endPreScriptTag.test(cap[0])) {
                this.lexer.state.inRawBlock = false;
            }
            return {
                type: 'html',
                raw: cap[0],
                inLink: this.lexer.state.inLink,
                inRawBlock: this.lexer.state.inRawBlock,
                block: false,
                text: cap[0],
            };
        }
    }
    link(src) {
        const cap = this.rules.inline.link.exec(src);
        if (cap) {
            const trimmedUrl = cap[2].trim();
            if (!this.options.pedantic && this.rules.other.startAngleBracket.test(trimmedUrl)) {
                // commonmark requires matching angle brackets
                if (!(this.rules.other.endAngleBracket.test(trimmedUrl))) {
                    return;
                }
                // ending angle bracket cannot be escaped
                const rtrimSlash = rtrim(trimmedUrl.slice(0, -1), '\\');
                if ((trimmedUrl.length - rtrimSlash.length) % 2 === 0) {
                    return;
                }
            }
            else {
                // find closing parenthesis
                const lastParenIndex = findClosingBracket(cap[2], '()');
                if (lastParenIndex === -2) {
                    // more open parens than closed
                    return;
                }
                if (lastParenIndex > -1) {
                    const start = cap[0].indexOf('!') === 0 ? 5 : 4;
                    const linkLen = start + cap[1].length + lastParenIndex;
                    cap[2] = cap[2].substring(0, lastParenIndex);
                    cap[0] = cap[0].substring(0, linkLen).trim();
                    cap[3] = '';
                }
            }
            let href = cap[2];
            let title = '';
            if (this.options.pedantic) {
                // split pedantic href and title
                const link = this.rules.other.pedanticHrefTitle.exec(href);
                if (link) {
                    href = link[1];
                    title = link[3];
                }
            }
            else {
                title = cap[3] ? cap[3].slice(1, -1) : '';
            }
            href = href.trim();
            if (this.rules.other.startAngleBracket.test(href)) {
                if (this.options.pedantic && !(this.rules.other.endAngleBracket.test(trimmedUrl))) {
                    // pedantic allows starting angle bracket without ending angle bracket
                    href = href.slice(1);
                }
                else {
                    href = href.slice(1, -1);
                }
            }
            return outputLink(cap, {
                href: href ? href.replace(this.rules.inline.anyPunctuation, '$1') : href,
                title: title ? title.replace(this.rules.inline.anyPunctuation, '$1') : title,
            }, cap[0], this.lexer, this.rules);
        }
    }
    reflink(src, links) {
        let cap;
        if ((cap = this.rules.inline.reflink.exec(src))
            || (cap = this.rules.inline.nolink.exec(src))) {
            const linkString = (cap[2] || cap[1]).replace(this.rules.other.multipleSpaceGlobal, ' ');
            const link = links[linkString.toLowerCase()];
            if (!link) {
                const text = cap[0].charAt(0);
                return {
                    type: 'text',
                    raw: text,
                    text,
                };
            }
            return outputLink(cap, link, cap[0], this.lexer, this.rules);
        }
    }
    emStrong(src, maskedSrc, prevChar = '') {
        let match = this.rules.inline.emStrongLDelim.exec(src);
        if (!match)
            return;
        // _ can't be between two alphanumerics. \p{L}\p{N} includes non-english alphabet/numbers as well
        if (match[3] && prevChar.match(this.rules.other.unicodeAlphaNumeric))
            return;
        const nextChar = match[1] || match[2] || '';
        if (!nextChar || !prevChar || this.rules.inline.punctuation.exec(prevChar)) {
            // unicode Regex counts emoji as 1 char; spread into array for proper count (used multiple times below)
            const lLength = [...match[0]].length - 1;
            let rDelim, rLength, delimTotal = lLength, midDelimTotal = 0;
            const endReg = match[0][0] === '*' ? this.rules.inline.emStrongRDelimAst : this.rules.inline.emStrongRDelimUnd;
            endReg.lastIndex = 0;
            // Clip maskedSrc to same section of string as src (move to lexer?)
            maskedSrc = maskedSrc.slice(-1 * src.length + lLength);
            while ((match = endReg.exec(maskedSrc)) != null) {
                rDelim = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];
                if (!rDelim)
                    continue; // skip single * in __abc*abc__
                rLength = [...rDelim].length;
                if (match[3] || match[4]) { // found another Left Delim
                    delimTotal += rLength;
                    continue;
                }
                else if (match[5] || match[6]) { // either Left or Right Delim
                    if (lLength % 3 && !((lLength + rLength) % 3)) {
                        midDelimTotal += rLength;
                        continue; // CommonMark Emphasis Rules 9-10
                    }
                }
                delimTotal -= rLength;
                if (delimTotal > 0)
                    continue; // Haven't found enough closing delimiters
                // Remove extra characters. *a*** -> *a*
                rLength = Math.min(rLength, rLength + delimTotal + midDelimTotal);
                // char length can be >1 for unicode characters;
                const lastCharLength = [...match[0]][0].length;
                const raw = src.slice(0, lLength + match.index + lastCharLength + rLength);
                // Create `em` if smallest delimiter has odd char count. *a***
                if (Math.min(lLength, rLength) % 2) {
                    const text = raw.slice(1, -1);
                    return {
                        type: 'em',
                        raw,
                        text,
                        tokens: this.lexer.inlineTokens(text),
                    };
                }
                // Create 'strong' if smallest delimiter has even char count. **a***
                const text = raw.slice(2, -2);
                return {
                    type: 'strong',
                    raw,
                    text,
                    tokens: this.lexer.inlineTokens(text),
                };
            }
        }
    }
    codespan(src) {
        const cap = this.rules.inline.code.exec(src);
        if (cap) {
            let text = cap[2].replace(this.rules.other.newLineCharGlobal, ' ');
            const hasNonSpaceChars = this.rules.other.nonSpaceChar.test(text);
            const hasSpaceCharsOnBothEnds = this.rules.other.startingSpaceChar.test(text) && this.rules.other.endingSpaceChar.test(text);
            if (hasNonSpaceChars && hasSpaceCharsOnBothEnds) {
                text = text.substring(1, text.length - 1);
            }
            return {
                type: 'codespan',
                raw: cap[0],
                text,
            };
        }
    }
    br(src) {
        const cap = this.rules.inline.br.exec(src);
        if (cap) {
            return {
                type: 'br',
                raw: cap[0],
            };
        }
    }
    del(src) {
        const cap = this.rules.inline.del.exec(src);
        if (cap) {
            return {
                type: 'del',
                raw: cap[0],
                text: cap[2],
                tokens: this.lexer.inlineTokens(cap[2]),
            };
        }
    }
    autolink(src) {
        const cap = this.rules.inline.autolink.exec(src);
        if (cap) {
            let text, href;
            if (cap[2] === '@') {
                text = cap[1];
                href = 'mailto:' + text;
            }
            else {
                text = cap[1];
                href = text;
            }
            return {
                type: 'link',
                raw: cap[0],
                text,
                href,
                tokens: [
                    {
                        type: 'text',
                        raw: text,
                        text,
                    },
                ],
            };
        }
    }
    url(src) {
        let cap;
        if (cap = this.rules.inline.url.exec(src)) {
            let text, href;
            if (cap[2] === '@') {
                text = cap[0];
                href = 'mailto:' + text;
            }
            else {
                // do extended autolink path validation
                let prevCapZero;
                do {
                    prevCapZero = cap[0];
                    cap[0] = this.rules.inline._backpedal.exec(cap[0])?.[0] ?? '';
                } while (prevCapZero !== cap[0]);
                text = cap[0];
                if (cap[1] === 'www.') {
                    href = 'http://' + cap[0];
                }
                else {
                    href = cap[0];
                }
            }
            return {
                type: 'link',
                raw: cap[0],
                text,
                href,
                tokens: [
                    {
                        type: 'text',
                        raw: text,
                        text,
                    },
                ],
            };
        }
    }
    inlineText(src) {
        const cap = this.rules.inline.text.exec(src);
        if (cap) {
            const escaped = this.lexer.state.inRawBlock;
            return {
                type: 'text',
                raw: cap[0],
                text: cap[0],
                escaped,
            };
        }
    }
}

/**
 * Block Lexer
 */
class _Lexer {
    tokens;
    options;
    state;
    tokenizer;
    inlineQueue;
    constructor(options) {
        // TokenList cannot be created in one go
        this.tokens = [];
        this.tokens.links = Object.create(null);
        this.options = options || exports.defaults;
        this.options.tokenizer = this.options.tokenizer || new _Tokenizer();
        this.tokenizer = this.options.tokenizer;
        this.tokenizer.options = this.options;
        this.tokenizer.lexer = this;
        this.inlineQueue = [];
        this.state = {
            inLink: false,
            inRawBlock: false,
            top: true,
        };
        const rules = {
            other,
            block: block.normal,
            inline: inline.normal,
        };
        if (this.options.pedantic) {
            rules.block = block.pedantic;
            rules.inline = inline.pedantic;
        }
        else if (this.options.gfm) {
            rules.block = block.gfm;
            if (this.options.breaks) {
                rules.inline = inline.breaks;
            }
            else {
                rules.inline = inline.gfm;
            }
        }
        this.tokenizer.rules = rules;
    }
    /**
     * Expose Rules
     */
    static get rules() {
        return {
            block,
            inline,
        };
    }
    /**
     * Static Lex Method
     */
    static lex(src, options) {
        const lexer = new _Lexer(options);
        return lexer.lex(src);
    }
    /**
     * Static Lex Inline Method
     */
    static lexInline(src, options) {
        const lexer = new _Lexer(options);
        return lexer.inlineTokens(src);
    }
    /**
     * Preprocessing
     */
    lex(src) {
        src = src.replace(other.carriageReturn, '\n');
        this.blockTokens(src, this.tokens);
        for (let i = 0; i < this.inlineQueue.length; i++) {
            const next = this.inlineQueue[i];
            this.inlineTokens(next.src, next.tokens);
        }
        this.inlineQueue = [];
        return this.tokens;
    }
    blockTokens(src, tokens = [], lastParagraphClipped = false) {
        if (this.options.pedantic) {
            src = src.replace(other.tabCharGlobal, '    ').replace(other.spaceLine, '');
        }
        while (src) {
            let token;
            if (this.options.extensions?.block?.some((extTokenizer) => {
                if (token = extTokenizer.call({ lexer: this }, src, tokens)) {
                    src = src.substring(token.raw.length);
                    tokens.push(token);
                    return true;
                }
                return false;
            })) {
                continue;
            }
            // newline
            if (token = this.tokenizer.space(src)) {
                src = src.substring(token.raw.length);
                const lastToken = tokens.at(-1);
                if (token.raw.length === 1 && lastToken !== undefined) {
                    // if there's a single \n as a spacer, it's terminating the last line,
                    // so move it there so that we don't get unnecessary paragraph tags
                    lastToken.raw += '\n';
                }
                else {
                    tokens.push(token);
                }
                continue;
            }
            // code
            if (token = this.tokenizer.code(src)) {
                src = src.substring(token.raw.length);
                const lastToken = tokens.at(-1);
                // An indented code block cannot interrupt a paragraph.
                if (lastToken?.type === 'paragraph' || lastToken?.type === 'text') {
                    lastToken.raw += '\n' + token.raw;
                    lastToken.text += '\n' + token.text;
                    this.inlineQueue.at(-1).src = lastToken.text;
                }
                else {
                    tokens.push(token);
                }
                continue;
            }
            // fences
            if (token = this.tokenizer.fences(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // heading
            if (token = this.tokenizer.heading(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // hr
            if (token = this.tokenizer.hr(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // blockquote
            if (token = this.tokenizer.blockquote(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // list
            if (token = this.tokenizer.list(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // html
            if (token = this.tokenizer.html(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // def
            if (token = this.tokenizer.def(src)) {
                src = src.substring(token.raw.length);
                const lastToken = tokens.at(-1);
                if (lastToken?.type === 'paragraph' || lastToken?.type === 'text') {
                    lastToken.raw += '\n' + token.raw;
                    lastToken.text += '\n' + token.raw;
                    this.inlineQueue.at(-1).src = lastToken.text;
                }
                else if (!this.tokens.links[token.tag]) {
                    this.tokens.links[token.tag] = {
                        href: token.href,
                        title: token.title,
                    };
                }
                continue;
            }
            // table (gfm)
            if (token = this.tokenizer.table(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // lheading
            if (token = this.tokenizer.lheading(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // top-level paragraph
            // prevent paragraph consuming extensions by clipping 'src' to extension start
            let cutSrc = src;
            if (this.options.extensions?.startBlock) {
                let startIndex = Infinity;
                const tempSrc = src.slice(1);
                let tempStart;
                this.options.extensions.startBlock.forEach((getStartIndex) => {
                    tempStart = getStartIndex.call({ lexer: this }, tempSrc);
                    if (typeof tempStart === 'number' && tempStart >= 0) {
                        startIndex = Math.min(startIndex, tempStart);
                    }
                });
                if (startIndex < Infinity && startIndex >= 0) {
                    cutSrc = src.substring(0, startIndex + 1);
                }
            }
            if (this.state.top && (token = this.tokenizer.paragraph(cutSrc))) {
                const lastToken = tokens.at(-1);
                if (lastParagraphClipped && lastToken?.type === 'paragraph') {
                    lastToken.raw += '\n' + token.raw;
                    lastToken.text += '\n' + token.text;
                    this.inlineQueue.pop();
                    this.inlineQueue.at(-1).src = lastToken.text;
                }
                else {
                    tokens.push(token);
                }
                lastParagraphClipped = cutSrc.length !== src.length;
                src = src.substring(token.raw.length);
                continue;
            }
            // text
            if (token = this.tokenizer.text(src)) {
                src = src.substring(token.raw.length);
                const lastToken = tokens.at(-1);
                if (lastToken?.type === 'text') {
                    lastToken.raw += '\n' + token.raw;
                    lastToken.text += '\n' + token.text;
                    this.inlineQueue.pop();
                    this.inlineQueue.at(-1).src = lastToken.text;
                }
                else {
                    tokens.push(token);
                }
                continue;
            }
            if (src) {
                const errMsg = 'Infinite loop on byte: ' + src.charCodeAt(0);
                if (this.options.silent) {
                    console.error(errMsg);
                    break;
                }
                else {
                    throw new Error(errMsg);
                }
            }
        }
        this.state.top = true;
        return tokens;
    }
    inline(src, tokens = []) {
        this.inlineQueue.push({ src, tokens });
        return tokens;
    }
    /**
     * Lexing/Compiling
     */
    inlineTokens(src, tokens = []) {
        // String with links masked to avoid interference with em and strong
        let maskedSrc = src;
        let match = null;
        // Mask out reflinks
        if (this.tokens.links) {
            const links = Object.keys(this.tokens.links);
            if (links.length > 0) {
                while ((match = this.tokenizer.rules.inline.reflinkSearch.exec(maskedSrc)) != null) {
                    if (links.includes(match[0].slice(match[0].lastIndexOf('[') + 1, -1))) {
                        maskedSrc = maskedSrc.slice(0, match.index)
                            + '[' + 'a'.repeat(match[0].length - 2) + ']'
                            + maskedSrc.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex);
                    }
                }
            }
        }
        // Mask out escaped characters
        while ((match = this.tokenizer.rules.inline.anyPunctuation.exec(maskedSrc)) != null) {
            maskedSrc = maskedSrc.slice(0, match.index) + '++' + maskedSrc.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);
        }
        // Mask out other blocks
        while ((match = this.tokenizer.rules.inline.blockSkip.exec(maskedSrc)) != null) {
            maskedSrc = maskedSrc.slice(0, match.index) + '[' + 'a'.repeat(match[0].length - 2) + ']' + maskedSrc.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);
        }
        let keepPrevChar = false;
        let prevChar = '';
        while (src) {
            if (!keepPrevChar) {
                prevChar = '';
            }
            keepPrevChar = false;
            let token;
            // extensions
            if (this.options.extensions?.inline?.some((extTokenizer) => {
                if (token = extTokenizer.call({ lexer: this }, src, tokens)) {
                    src = src.substring(token.raw.length);
                    tokens.push(token);
                    return true;
                }
                return false;
            })) {
                continue;
            }
            // escape
            if (token = this.tokenizer.escape(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // tag
            if (token = this.tokenizer.tag(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // link
            if (token = this.tokenizer.link(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // reflink, nolink
            if (token = this.tokenizer.reflink(src, this.tokens.links)) {
                src = src.substring(token.raw.length);
                const lastToken = tokens.at(-1);
                if (token.type === 'text' && lastToken?.type === 'text') {
                    lastToken.raw += token.raw;
                    lastToken.text += token.text;
                }
                else {
                    tokens.push(token);
                }
                continue;
            }
            // em & strong
            if (token = this.tokenizer.emStrong(src, maskedSrc, prevChar)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // code
            if (token = this.tokenizer.codespan(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // br
            if (token = this.tokenizer.br(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // del (gfm)
            if (token = this.tokenizer.del(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // autolink
            if (token = this.tokenizer.autolink(src)) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // url (gfm)
            if (!this.state.inLink && (token = this.tokenizer.url(src))) {
                src = src.substring(token.raw.length);
                tokens.push(token);
                continue;
            }
            // text
            // prevent inlineText consuming extensions by clipping 'src' to extension start
            let cutSrc = src;
            if (this.options.extensions?.startInline) {
                let startIndex = Infinity;
                const tempSrc = src.slice(1);
                let tempStart;
                this.options.extensions.startInline.forEach((getStartIndex) => {
                    tempStart = getStartIndex.call({ lexer: this }, tempSrc);
                    if (typeof tempStart === 'number' && tempStart >= 0) {
                        startIndex = Math.min(startIndex, tempStart);
                    }
                });
                if (startIndex < Infinity && startIndex >= 0) {
                    cutSrc = src.substring(0, startIndex + 1);
                }
            }
            if (token = this.tokenizer.inlineText(cutSrc)) {
                src = src.substring(token.raw.length);
                if (token.raw.slice(-1) !== '_') { // Track prevChar before string of ____ started
                    prevChar = token.raw.slice(-1);
                }
                keepPrevChar = true;
                const lastToken = tokens.at(-1);
                if (lastToken?.type === 'text') {
                    lastToken.raw += token.raw;
                    lastToken.text += token.text;
                }
                else {
                    tokens.push(token);
                }
                continue;
            }
            if (src) {
                const errMsg = 'Infinite loop on byte: ' + src.charCodeAt(0);
                if (this.options.silent) {
                    console.error(errMsg);
                    break;
                }
                else {
                    throw new Error(errMsg);
                }
            }
        }
        return tokens;
    }
}

/**
 * Renderer
 */
class _Renderer {
    options;
    parser; // set by the parser
    constructor(options) {
        this.options = options || exports.defaults;
    }
    space(token) {
        return '';
    }
    code({ text, lang, escaped }) {
        const langString = (lang || '').match(other.notSpaceStart)?.[0];
        const code = text.replace(other.endingNewline, '') + '\n';
        if (!langString) {
            return '<pre><code>'
                + (escaped ? code : escape(code, true))
                + '</code></pre>\n';
        }
        return '<pre><code class="language-'
            + escape(langString)
            + '">'
            + (escaped ? code : escape(code, true))
            + '</code></pre>\n';
    }
    blockquote({ tokens }) {
        const body = this.parser.parse(tokens);
        return `<blockquote>\n${body}</blockquote>\n`;
    }
    html({ text }) {
        return text;
    }
    heading({ tokens, depth }) {
        return `<h${depth}>${this.parser.parseInline(tokens)}</h${depth}>\n`;
    }
    hr(token) {
        return '<hr>\n';
    }
    list(token) {
        const ordered = token.ordered;
        const start = token.start;
        let body = '';
        for (let j = 0; j < token.items.length; j++) {
            const item = token.items[j];
            body += this.listitem(item);
        }
        const type = ordered ? 'ol' : 'ul';
        const startAttr = (ordered && start !== 1) ? (' start="' + start + '"') : '';
        return '<' + type + startAttr + '>\n' + body + '</' + type + '>\n';
    }
    listitem(item) {
        let itemBody = '';
        if (item.task) {
            const checkbox = this.checkbox({ checked: !!item.checked });
            if (item.loose) {
                if (item.tokens[0]?.type === 'paragraph') {
                    item.tokens[0].text = checkbox + ' ' + item.tokens[0].text;
                    if (item.tokens[0].tokens && item.tokens[0].tokens.length > 0 && item.tokens[0].tokens[0].type === 'text') {
                        item.tokens[0].tokens[0].text = checkbox + ' ' + escape(item.tokens[0].tokens[0].text);
                        item.tokens[0].tokens[0].escaped = true;
                    }
                }
                else {
                    item.tokens.unshift({
                        type: 'text',
                        raw: checkbox + ' ',
                        text: checkbox + ' ',
                        escaped: true,
                    });
                }
            }
            else {
                itemBody += checkbox + ' ';
            }
        }
        itemBody += this.parser.parse(item.tokens, !!item.loose);
        return `<li>${itemBody}</li>\n`;
    }
    checkbox({ checked }) {
        return '<input '
            + (checked ? 'checked="" ' : '')
            + 'disabled="" type="checkbox">';
    }
    paragraph({ tokens }) {
        return `<p>${this.parser.parseInline(tokens)}</p>\n`;
    }
    table(token) {
        let header = '';
        // header
        let cell = '';
        for (let j = 0; j < token.header.length; j++) {
            cell += this.tablecell(token.header[j]);
        }
        header += this.tablerow({ text: cell });
        let body = '';
        for (let j = 0; j < token.rows.length; j++) {
            const row = token.rows[j];
            cell = '';
            for (let k = 0; k < row.length; k++) {
                cell += this.tablecell(row[k]);
            }
            body += this.tablerow({ text: cell });
        }
        if (body)
            body = `<tbody>${body}</tbody>`;
        return '<table>\n'
            + '<thead>\n'
            + header
            + '</thead>\n'
            + body
            + '</table>\n';
    }
    tablerow({ text }) {
        return `<tr>\n${text}</tr>\n`;
    }
    tablecell(token) {
        const content = this.parser.parseInline(token.tokens);
        const type = token.header ? 'th' : 'td';
        const tag = token.align
            ? `<${type} align="${token.align}">`
            : `<${type}>`;
        return tag + content + `</${type}>\n`;
    }
    /**
     * span level renderer
     */
    strong({ tokens }) {
        return `<strong>${this.parser.parseInline(tokens)}</strong>`;
    }
    em({ tokens }) {
        return `<em>${this.parser.parseInline(tokens)}</em>`;
    }
    codespan({ text }) {
        return `<code>${escape(text, true)}</code>`;
    }
    br(token) {
        return '<br>';
    }
    del({ tokens }) {
        return `<del>${this.parser.parseInline(tokens)}</del>`;
    }
    link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const cleanHref = cleanUrl(href);
        if (cleanHref === null) {
            return text;
        }
        href = cleanHref;
        let out = '<a href="' + href + '"';
        if (title) {
            out += ' title="' + (escape(title)) + '"';
        }
        out += '>' + text + '</a>';
        return out;
    }
    image({ href, title, text, tokens }) {
        if (tokens) {
            text = this.parser.parseInline(tokens, this.parser.textRenderer);
        }
        const cleanHref = cleanUrl(href);
        if (cleanHref === null) {
            return escape(text);
        }
        href = cleanHref;
        let out = `<img src="${href}" alt="${text}"`;
        if (title) {
            out += ` title="${escape(title)}"`;
        }
        out += '>';
        return out;
    }
    text(token) {
        return 'tokens' in token && token.tokens
            ? this.parser.parseInline(token.tokens)
            : ('escaped' in token && token.escaped ? token.text : escape(token.text));
    }
}

/**
 * TextRenderer
 * returns only the textual part of the token
 */
class _TextRenderer {
    // no need for block level renderers
    strong({ text }) {
        return text;
    }
    em({ text }) {
        return text;
    }
    codespan({ text }) {
        return text;
    }
    del({ text }) {
        return text;
    }
    html({ text }) {
        return text;
    }
    text({ text }) {
        return text;
    }
    link({ text }) {
        return '' + text;
    }
    image({ text }) {
        return '' + text;
    }
    br() {
        return '';
    }
}

/**
 * Parsing & Compiling
 */
class _Parser {
    options;
    renderer;
    textRenderer;
    constructor(options) {
        this.options = options || exports.defaults;
        this.options.renderer = this.options.renderer || new _Renderer();
        this.renderer = this.options.renderer;
        this.renderer.options = this.options;
        this.renderer.parser = this;
        this.textRenderer = new _TextRenderer();
    }
    /**
     * Static Parse Method
     */
    static parse(tokens, options) {
        const parser = new _Parser(options);
        return parser.parse(tokens);
    }
    /**
     * Static Parse Inline Method
     */
    static parseInline(tokens, options) {
        const parser = new _Parser(options);
        return parser.parseInline(tokens);
    }
    /**
     * Parse Loop
     */
    parse(tokens, top = true) {
        let out = '';
        for (let i = 0; i < tokens.length; i++) {
            const anyToken = tokens[i];
            // Run any renderer extensions
            if (this.options.extensions?.renderers?.[anyToken.type]) {
                const genericToken = anyToken;
                const ret = this.options.extensions.renderers[genericToken.type].call({ parser: this }, genericToken);
                if (ret !== false || !['space', 'hr', 'heading', 'code', 'table', 'blockquote', 'list', 'html', 'paragraph', 'text'].includes(genericToken.type)) {
                    out += ret || '';
                    continue;
                }
            }
            const token = anyToken;
            switch (token.type) {
                case 'space': {
                    out += this.renderer.space(token);
                    continue;
                }
                case 'hr': {
                    out += this.renderer.hr(token);
                    continue;
                }
                case 'heading': {
                    out += this.renderer.heading(token);
                    continue;
                }
                case 'code': {
                    out += this.renderer.code(token);
                    continue;
                }
                case 'table': {
                    out += this.renderer.table(token);
                    continue;
                }
                case 'blockquote': {
                    out += this.renderer.blockquote(token);
                    continue;
                }
                case 'list': {
                    out += this.renderer.list(token);
                    continue;
                }
                case 'html': {
                    out += this.renderer.html(token);
                    continue;
                }
                case 'paragraph': {
                    out += this.renderer.paragraph(token);
                    continue;
                }
                case 'text': {
                    let textToken = token;
                    let body = this.renderer.text(textToken);
                    while (i + 1 < tokens.length && tokens[i + 1].type === 'text') {
                        textToken = tokens[++i];
                        body += '\n' + this.renderer.text(textToken);
                    }
                    if (top) {
                        out += this.renderer.paragraph({
                            type: 'paragraph',
                            raw: body,
                            text: body,
                            tokens: [{ type: 'text', raw: body, text: body, escaped: true }],
                        });
                    }
                    else {
                        out += body;
                    }
                    continue;
                }
                default: {
                    const errMsg = 'Token with "' + token.type + '" type was not found.';
                    if (this.options.silent) {
                        console.error(errMsg);
                        return '';
                    }
                    else {
                        throw new Error(errMsg);
                    }
                }
            }
        }
        return out;
    }
    /**
     * Parse Inline Tokens
     */
    parseInline(tokens, renderer = this.renderer) {
        let out = '';
        for (let i = 0; i < tokens.length; i++) {
            const anyToken = tokens[i];
            // Run any renderer extensions
            if (this.options.extensions?.renderers?.[anyToken.type]) {
                const ret = this.options.extensions.renderers[anyToken.type].call({ parser: this }, anyToken);
                if (ret !== false || !['escape', 'html', 'link', 'image', 'strong', 'em', 'codespan', 'br', 'del', 'text'].includes(anyToken.type)) {
                    out += ret || '';
                    continue;
                }
            }
            const token = anyToken;
            switch (token.type) {
                case 'escape': {
                    out += renderer.text(token);
                    break;
                }
                case 'html': {
                    out += renderer.html(token);
                    break;
                }
                case 'link': {
                    out += renderer.link(token);
                    break;
                }
                case 'image': {
                    out += renderer.image(token);
                    break;
                }
                case 'strong': {
                    out += renderer.strong(token);
                    break;
                }
                case 'em': {
                    out += renderer.em(token);
                    break;
                }
                case 'codespan': {
                    out += renderer.codespan(token);
                    break;
                }
                case 'br': {
                    out += renderer.br(token);
                    break;
                }
                case 'del': {
                    out += renderer.del(token);
                    break;
                }
                case 'text': {
                    out += renderer.text(token);
                    break;
                }
                default: {
                    const errMsg = 'Token with "' + token.type + '" type was not found.';
                    if (this.options.silent) {
                        console.error(errMsg);
                        return '';
                    }
                    else {
                        throw new Error(errMsg);
                    }
                }
            }
        }
        return out;
    }
}

class _Hooks {
    options;
    block;
    constructor(options) {
        this.options = options || exports.defaults;
    }
    static passThroughHooks = new Set([
        'preprocess',
        'postprocess',
        'processAllTokens',
    ]);
    /**
     * Process markdown before marked
     */
    preprocess(markdown) {
        return markdown;
    }
    /**
     * Process HTML after marked is finished
     */
    postprocess(html) {
        return html;
    }
    /**
     * Process all tokens before walk tokens
     */
    processAllTokens(tokens) {
        return tokens;
    }
    /**
     * Provide function to tokenize markdown
     */
    provideLexer() {
        return this.block ? _Lexer.lex : _Lexer.lexInline;
    }
    /**
     * Provide function to parse tokens
     */
    provideParser() {
        return this.block ? _Parser.parse : _Parser.parseInline;
    }
}

class Marked {
    defaults = _getDefaults();
    options = this.setOptions;
    parse = this.parseMarkdown(true);
    parseInline = this.parseMarkdown(false);
    Parser = _Parser;
    Renderer = _Renderer;
    TextRenderer = _TextRenderer;
    Lexer = _Lexer;
    Tokenizer = _Tokenizer;
    Hooks = _Hooks;
    constructor(...args) {
        this.use(...args);
    }
    /**
     * Run callback for every token
     */
    walkTokens(tokens, callback) {
        let values = [];
        for (const token of tokens) {
            values = values.concat(callback.call(this, token));
            switch (token.type) {
                case 'table': {
                    const tableToken = token;
                    for (const cell of tableToken.header) {
                        values = values.concat(this.walkTokens(cell.tokens, callback));
                    }
                    for (const row of tableToken.rows) {
                        for (const cell of row) {
                            values = values.concat(this.walkTokens(cell.tokens, callback));
                        }
                    }
                    break;
                }
                case 'list': {
                    const listToken = token;
                    values = values.concat(this.walkTokens(listToken.items, callback));
                    break;
                }
                default: {
                    const genericToken = token;
                    if (this.defaults.extensions?.childTokens?.[genericToken.type]) {
                        this.defaults.extensions.childTokens[genericToken.type].forEach((childTokens) => {
                            const tokens = genericToken[childTokens].flat(Infinity);
                            values = values.concat(this.walkTokens(tokens, callback));
                        });
                    }
                    else if (genericToken.tokens) {
                        values = values.concat(this.walkTokens(genericToken.tokens, callback));
                    }
                }
            }
        }
        return values;
    }
    use(...args) {
        const extensions = this.defaults.extensions || { renderers: {}, childTokens: {} };
        args.forEach((pack) => {
            // copy options to new object
            const opts = { ...pack };
            // set async to true if it was set to true before
            opts.async = this.defaults.async || opts.async || false;
            // ==-- Parse "addon" extensions --== //
            if (pack.extensions) {
                pack.extensions.forEach((ext) => {
                    if (!ext.name) {
                        throw new Error('extension name required');
                    }
                    if ('renderer' in ext) { // Renderer extensions
                        const prevRenderer = extensions.renderers[ext.name];
                        if (prevRenderer) {
                            // Replace extension with func to run new extension but fall back if false
                            extensions.renderers[ext.name] = function (...args) {
                                let ret = ext.renderer.apply(this, args);
                                if (ret === false) {
                                    ret = prevRenderer.apply(this, args);
                                }
                                return ret;
                            };
                        }
                        else {
                            extensions.renderers[ext.name] = ext.renderer;
                        }
                    }
                    if ('tokenizer' in ext) { // Tokenizer Extensions
                        if (!ext.level || (ext.level !== 'block' && ext.level !== 'inline')) {
                            throw new Error("extension level must be 'block' or 'inline'");
                        }
                        const extLevel = extensions[ext.level];
                        if (extLevel) {
                            extLevel.unshift(ext.tokenizer);
                        }
                        else {
                            extensions[ext.level] = [ext.tokenizer];
                        }
                        if (ext.start) { // Function to check for start of token
                            if (ext.level === 'block') {
                                if (extensions.startBlock) {
                                    extensions.startBlock.push(ext.start);
                                }
                                else {
                                    extensions.startBlock = [ext.start];
                                }
                            }
                            else if (ext.level === 'inline') {
                                if (extensions.startInline) {
                                    extensions.startInline.push(ext.start);
                                }
                                else {
                                    extensions.startInline = [ext.start];
                                }
                            }
                        }
                    }
                    if ('childTokens' in ext && ext.childTokens) { // Child tokens to be visited by walkTokens
                        extensions.childTokens[ext.name] = ext.childTokens;
                    }
                });
                opts.extensions = extensions;
            }
            // ==-- Parse "overwrite" extensions --== //
            if (pack.renderer) {
                const renderer = this.defaults.renderer || new _Renderer(this.defaults);
                for (const prop in pack.renderer) {
                    if (!(prop in renderer)) {
                        throw new Error(`renderer '${prop}' does not exist`);
                    }
                    if (['options', 'parser'].includes(prop)) {
                        // ignore options property
                        continue;
                    }
                    const rendererProp = prop;
                    const rendererFunc = pack.renderer[rendererProp];
                    const prevRenderer = renderer[rendererProp];
                    // Replace renderer with func to run extension, but fall back if false
                    renderer[rendererProp] = (...args) => {
                        let ret = rendererFunc.apply(renderer, args);
                        if (ret === false) {
                            ret = prevRenderer.apply(renderer, args);
                        }
                        return ret || '';
                    };
                }
                opts.renderer = renderer;
            }
            if (pack.tokenizer) {
                const tokenizer = this.defaults.tokenizer || new _Tokenizer(this.defaults);
                for (const prop in pack.tokenizer) {
                    if (!(prop in tokenizer)) {
                        throw new Error(`tokenizer '${prop}' does not exist`);
                    }
                    if (['options', 'rules', 'lexer'].includes(prop)) {
                        // ignore options, rules, and lexer properties
                        continue;
                    }
                    const tokenizerProp = prop;
                    const tokenizerFunc = pack.tokenizer[tokenizerProp];
                    const prevTokenizer = tokenizer[tokenizerProp];
                    // Replace tokenizer with func to run extension, but fall back if false
                    // @ts-expect-error cannot type tokenizer function dynamically
                    tokenizer[tokenizerProp] = (...args) => {
                        let ret = tokenizerFunc.apply(tokenizer, args);
                        if (ret === false) {
                            ret = prevTokenizer.apply(tokenizer, args);
                        }
                        return ret;
                    };
                }
                opts.tokenizer = tokenizer;
            }
            // ==-- Parse Hooks extensions --== //
            if (pack.hooks) {
                const hooks = this.defaults.hooks || new _Hooks();
                for (const prop in pack.hooks) {
                    if (!(prop in hooks)) {
                        throw new Error(`hook '${prop}' does not exist`);
                    }
                    if (['options', 'block'].includes(prop)) {
                        // ignore options and block properties
                        continue;
                    }
                    const hooksProp = prop;
                    const hooksFunc = pack.hooks[hooksProp];
                    const prevHook = hooks[hooksProp];
                    if (_Hooks.passThroughHooks.has(prop)) {
                        // @ts-expect-error cannot type hook function dynamically
                        hooks[hooksProp] = (arg) => {
                            if (this.defaults.async) {
                                return Promise.resolve(hooksFunc.call(hooks, arg)).then(ret => {
                                    return prevHook.call(hooks, ret);
                                });
                            }
                            const ret = hooksFunc.call(hooks, arg);
                            return prevHook.call(hooks, ret);
                        };
                    }
                    else {
                        // @ts-expect-error cannot type hook function dynamically
                        hooks[hooksProp] = (...args) => {
                            let ret = hooksFunc.apply(hooks, args);
                            if (ret === false) {
                                ret = prevHook.apply(hooks, args);
                            }
                            return ret;
                        };
                    }
                }
                opts.hooks = hooks;
            }
            // ==-- Parse WalkTokens extensions --== //
            if (pack.walkTokens) {
                const walkTokens = this.defaults.walkTokens;
                const packWalktokens = pack.walkTokens;
                opts.walkTokens = function (token) {
                    let values = [];
                    values.push(packWalktokens.call(this, token));
                    if (walkTokens) {
                        values = values.concat(walkTokens.call(this, token));
                    }
                    return values;
                };
            }
            this.defaults = { ...this.defaults, ...opts };
        });
        return this;
    }
    setOptions(opt) {
        this.defaults = { ...this.defaults, ...opt };
        return this;
    }
    lexer(src, options) {
        return _Lexer.lex(src, options ?? this.defaults);
    }
    parser(tokens, options) {
        return _Parser.parse(tokens, options ?? this.defaults);
    }
    parseMarkdown(blockType) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parse = (src, options) => {
            const origOpt = { ...options };
            const opt = { ...this.defaults, ...origOpt };
            const throwError = this.onError(!!opt.silent, !!opt.async);
            // throw error if an extension set async to true but parse was called with async: false
            if (this.defaults.async === true && origOpt.async === false) {
                return throwError(new Error('marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise.'));
            }
            // throw error in case of non string input
            if (typeof src === 'undefined' || src === null) {
                return throwError(new Error('marked(): input parameter is undefined or null'));
            }
            if (typeof src !== 'string') {
                return throwError(new Error('marked(): input parameter is of type '
                    + Object.prototype.toString.call(src) + ', string expected'));
            }
            if (opt.hooks) {
                opt.hooks.options = opt;
                opt.hooks.block = blockType;
            }
            const lexer = opt.hooks ? opt.hooks.provideLexer() : (blockType ? _Lexer.lex : _Lexer.lexInline);
            const parser = opt.hooks ? opt.hooks.provideParser() : (blockType ? _Parser.parse : _Parser.parseInline);
            if (opt.async) {
                return Promise.resolve(opt.hooks ? opt.hooks.preprocess(src) : src)
                    .then(src => lexer(src, opt))
                    .then(tokens => opt.hooks ? opt.hooks.processAllTokens(tokens) : tokens)
                    .then(tokens => opt.walkTokens ? Promise.all(this.walkTokens(tokens, opt.walkTokens)).then(() => tokens) : tokens)
                    .then(tokens => parser(tokens, opt))
                    .then(html => opt.hooks ? opt.hooks.postprocess(html) : html)
                    .catch(throwError);
            }
            try {
                if (opt.hooks) {
                    src = opt.hooks.preprocess(src);
                }
                let tokens = lexer(src, opt);
                if (opt.hooks) {
                    tokens = opt.hooks.processAllTokens(tokens);
                }
                if (opt.walkTokens) {
                    this.walkTokens(tokens, opt.walkTokens);
                }
                let html = parser(tokens, opt);
                if (opt.hooks) {
                    html = opt.hooks.postprocess(html);
                }
                return html;
            }
            catch (e) {
                return throwError(e);
            }
        };
        return parse;
    }
    onError(silent, async) {
        return (e) => {
            e.message += '\nPlease report this to https://github.com/markedjs/marked.';
            if (silent) {
                const msg = '<p>An error occurred:</p><pre>'
                    + escape(e.message + '', true)
                    + '</pre>';
                if (async) {
                    return Promise.resolve(msg);
                }
                return msg;
            }
            if (async) {
                return Promise.reject(e);
            }
            throw e;
        };
    }
}

const markedInstance = new Marked();
function marked(src, opt) {
    return markedInstance.parse(src, opt);
}
/**
 * Sets the default options.
 *
 * @param options Hash of options
 */
marked.options =
    marked.setOptions = function (options) {
        markedInstance.setOptions(options);
        marked.defaults = markedInstance.defaults;
        changeDefaults(marked.defaults);
        return marked;
    };
/**
 * Gets the original marked default options.
 */
marked.getDefaults = _getDefaults;
marked.defaults = exports.defaults;
/**
 * Use Extension
 */
marked.use = function (...args) {
    markedInstance.use(...args);
    marked.defaults = markedInstance.defaults;
    changeDefaults(marked.defaults);
    return marked;
};
/**
 * Run callback for every token
 */
marked.walkTokens = function (tokens, callback) {
    return markedInstance.walkTokens(tokens, callback);
};
/**
 * Compiles markdown to HTML without enclosing `p` tag.
 *
 * @param src String of markdown source to be compiled
 * @param options Hash of options
 * @return String of compiled HTML
 */
marked.parseInline = markedInstance.parseInline;
/**
 * Expose
 */
marked.Parser = _Parser;
marked.parser = _Parser.parse;
marked.Renderer = _Renderer;
marked.TextRenderer = _TextRenderer;
marked.Lexer = _Lexer;
marked.lexer = _Lexer.lex;
marked.Tokenizer = _Tokenizer;
marked.Hooks = _Hooks;
marked.parse = marked;
const options = marked.options;
const setOptions = marked.setOptions;
const use = marked.use;
const walkTokens = marked.walkTokens;
const parseInline = marked.parseInline;
const parse = marked;
const parser = _Parser.parse;
const lexer = _Lexer.lex;

exports.Hooks = _Hooks;
exports.Lexer = _Lexer;
exports.Marked = Marked;
exports.Parser = _Parser;
exports.Renderer = _Renderer;
exports.TextRenderer = _TextRenderer;
exports.Tokenizer = _Tokenizer;
exports.getDefaults = _getDefaults;
exports.lexer = lexer;
exports.marked = marked;
exports.options = options;
exports.parse = parse;
exports.parseInline = parseInline;
exports.parser = parser;
exports.setOptions = setOptions;
exports.use = use;
exports.walkTokens = walkTokens;
//# sourceMappingURL=marked.cjs.map


/***/ })
/******/ 	]);
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module is referenced by other modules so it can't be inlined
/******/ 	var __webpack_exports__ = __webpack_require__(0);
/******/ 	module.exports = __webpack_exports__;
/******/ 	
/******/ })()
;
//# sourceMappingURL=extension.js.map