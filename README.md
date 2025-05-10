<<<<<<< HEAD
# curze
=======
# Svala - Cursor聊天记录查看器

Svala是一个VSCode扩展，用于查看和管理Cursor聊天记录。

## 功能

- 显示Cursor的聊天记录列表
- 查看完整的聊天对话内容
- 支持Markdown和代码高亮
- 适配VSCode主题

## 代码结构

最新的代码重构采用了分层架构设计，提高了代码的可维护性和可扩展性：

### 数据访问层 (Data Access Layer)

- `dbGet` / `dbAll`: Promise化的数据库查询函数
- `getAllComposersFromWorkspaceDb`: 从工作区数据库获取所有对话引用
- `getMainRecordFromGlobalDb`: 从全局存储获取对话元数据
- `getBubblesFromGlobalDb`: 从全局存储获取对话气泡内容

### 业务逻辑层 (Business Logic Layer)

- `findWorkspaceDb`: 智能查找工作区数据库位置
- `getFullConversation`: 整合数据访问层函数，获取完整对话内容

### 视图层 (View Layer)

- `formatMessageContent`: 格式化消息内容，处理Markdown
- `generateChatHistoryHtml`: 生成对话HTML页面
- `generateErrorHtml`: 生成错误信息页面

### 数据结构映射

| 层级 | 数据库位置 | 表名 | 字段名/Key | 作用 |
|------|------------|--------|--------|------|
| 工作区 | workspaceStorage | ItemTable | `composer.composerData.allComposers` | 存储所有对话的引用列表 |
| 对话 | globalStorage | ItemTable | `composerData:{composerId}` | 包含对话元数据 |
| 对话 | globalStorage | cursorDiskKV | `composerId` | 对话唯一标识符，用于关联气泡 |
| 对话 | globalStorage | cursorDiskKV | `fullConversationHeadersOnly` | 存储所有气泡ID和时间戳 |
| 气泡 | globalStorage | cursorDiskKV | `bubbleId:{composerId}:{bubbleId}` | 气泡完整存储键 |
| 气泡 | globalStorage | cursorDiskKV | `bubbleId` | 气泡唯一标识符 |
| 气泡 | globalStorage | cursorDiskKV | `role` | 区分用户输入和AI回复 |
| 气泡 | globalStorage | cursorDiskKV | `content` | 存储实际对话内容 |

## 安装

1. 下载最新的 `.vsix` 文件
2. 在VSCode中，转到扩展视图
3. 点击右上角的"..."，选择"从VSIX安装..."
4. 选择下载的 `.vsix` 文件

## 使用方法

1. 打开命令面板 (`Ctrl+Shift+P` 或 `Cmd+Shift+P`)
2. 输入 "Svala: 显示聊天记录列表" 并选择
3. 选择一个工作区以查看其聊天记录

## 注意事项

- 此扩展需要访问Cursor的数据库文件，这些文件通常位于用户的工作区存储和全局存储目录中
- 如果遇到问题，可以查看输出面板中的日志信息

## 开发

### 构建

```bash
npm install
npm run compile
```

### 打包

```bash
npm run package
```

### 调试

在VSCode中按F5启动调试会话。

## 许可证

MIT
>>>>>>> 60604c8 (初始提交：VSCode Cursor 聊天记录扩展)
