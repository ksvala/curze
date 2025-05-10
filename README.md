# Svala - Cursor Chat History Viewer

Svala is a VSCode extension for viewing and managing Cursor chat history.

## Features

- Display a list of Cursor chat histories
- View complete conversation content
- Support for Markdown and code highlighting
- Adapt to VSCode themes

## Code Structure

The latest code refactoring adopts a layered architecture design, improving code maintainability and scalability:

### Data Access Layer

- `dbGet` / `dbAll`: Promise-based database query functions
- `getAllComposersFromWorkspaceDb`: Get all conversation references from the workspace database
- `getMainRecordFromGlobalDb`: Get conversation metadata from global storage
- `getBubblesFromGlobalDb`: Get conversation bubble content from global storage

### Business Logic Layer

- `findWorkspaceDb`: Intelligently find the workspace database location
- `getFullConversation`: Integrate data access layer functions to get complete conversation content

### View Layer

- `formatMessageContent`: Format message content, handle Markdown
- `generateChatHistoryHtml`: Generate conversation HTML page
- `generateErrorHtml`: Generate error information page

### Data Structure Mapping

| Level      | Database Location | Table Name | Field Name/Key | Description |
|------------|------------------|------------|----------------|-------------|
| Workspace  | workspaceStorage | ItemTable  | `composer.composerData.allComposers` | Stores all conversation reference lists |
| Conversation | globalStorage | ItemTable | `composerData:{composerId}` | Contains conversation metadata |
| Conversation | globalStorage | cursorDiskKV | `composerId` | Unique conversation identifier, used to associate bubbles |
| Conversation | globalStorage | cursorDiskKV | `fullConversationHeadersOnly` | Stores all bubble IDs and timestamps |
| Bubble     | globalStorage | cursorDiskKV | `bubbleId:{composerId}:{bubbleId}` | Complete bubble storage key |
| Bubble     | globalStorage | cursorDiskKV | `bubbleId` | Unique bubble identifier |
| Bubble     | globalStorage | cursorDiskKV | `role` | Distinguishes user input and AI reply |
| Bubble     | globalStorage | cursorDiskKV | `content` | Stores actual conversation content |

## Installation

1. Download the latest `.vsix` file
2. In VSCode, go to the Extensions view
3. Click the "..." in the upper right corner and select "Install from VSIX..."
4. Select the downloaded `.vsix` file

## Usage

1. Open the command palette (`Ctrl+Shift+P` or `Cmd+Shift+P`)
2. Type "Svala: Show Chat History List" and select it
3. Select a workspace to view its chat history

## Notes

- This extension needs to access Cursor's database files, which are usually located in the user's workspace storage and global storage directories
- If you encounter problems, you can check the log information in the output panel

## Development

### Build

```bash
npm install
npm run compile
```

### Package

```bash
npm run package
```

### Debug

Press F5 in VSCode to start a debug session.

## License

MIT
