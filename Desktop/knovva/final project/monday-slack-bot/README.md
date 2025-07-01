# Monday-Slack Bot

A Node.js bot that integrates Monday.com with Slack to automatically send project status updates at scheduled intervals.

## Features

- 🔄 **Automated Scheduling**: Send project updates at configurable intervals using cron expressions
- 📊 **Project Status Reports**: Fetch and display project information from Monday.com boards
- 💬 **Slack Integration**: Send formatted messages to Slack channels
- 📝 **Comprehensive Logging**: Winston-based logging with file and console output
- ⚙️ **Configurable**: Easy configuration through environment variables
- 🛡️ **Error Handling**: Robust error handling with Slack notifications

## Prerequisites

- Node.js (v14 or higher)
- Monday.com account with API access
- Slack workspace with bot permissions

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd monday-slack-bot
```

2. Install dependencies:
```bash
npm install
```

3. Copy the environment example file:
```bash
cp env.example .env
```

4. Configure your environment variables in `.env` file

## Configuration

### Environment Variables

Create a `.env` file with the following variables:

```env
# Monday.com API Configuration
MONDAY_API_TOKEN=your_monday_api_token_here
MONDAY_BOARD_ID=your_board_id_here

# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token-here
SLACK_APP_TOKEN=xapp-your-app-level-token-here
SLACK_CHANNEL_ID=your_channel_id_here

# Bot Configuration
CRON_SCHEDULE=0 9 * * 1-5         # Every weekday at 9 AM
TIMEZONE=America/New_York         # Use a valid IANA timezone string, e.g., Asia/Shanghai, Europe/London

# Logging
LOG_LEVEL=info
```

### Getting Monday.com API Token

1. Go to your Monday.com account
2. Navigate to Admin → API
3. Generate a new API token
4. Copy the token to your `.env` file

### Getting Monday.com Board ID

1. Open your Monday.com board
2. The board ID is in the URL: `https://monday.com/boards/{BOARD_ID}`
3. Copy the board ID to your `.env` file

### Setting up Slack Bot

1. Go to [Slack API Apps](https://api.slack.com/apps)
2. Create a new app
3. Add the following bot token scopes:
   - `chat:write`
   - `chat:write.public`
4. Install the app to your workspace
5. Copy the bot token (starts with `xoxb-`) to your `.env` file
6. Invite the bot to your target channel

### Getting Slack Channel ID

1. Right-click on the channel in Slack
2. Select "Copy link"
3. The channel ID is the last part of the URL after the workspace name

## Usage

### Start the Bot

```bash
npm start
```

### Development Mode

```bash
npm run dev
```

### Manual Trigger

You can also trigger updates manually by importing and using the bot:

```javascript
const { MondaySlackBot } = require('./index');

const bot = new MondaySlackBot();
bot.triggerManualUpdate();
```

## Cron Schedule Configuration

The bot uses cron expressions for scheduling. Here are some common examples:

- `"0 9 * * 1-5"` - Weekdays at 9 AM
- `"0 */6 * * *"` - Every 6 hours
- `"0 9,17 * * 1-5"` - Weekdays at 9 AM and 5 PM
- `"0 9 * * 0"` - Sundays at 9 AM

## Project Structure

```
monday-slack-bot/
├── index.js          # Main bot application
├── package.json      # Dependencies and scripts
├── env.example       # Environment variables template
├── README.md         # This file
├── error.log         # Error logs (generated)
└── combined.log      # Combined logs (generated)
```

## Message Format

The bot sends formatted messages to Slack with the following information for each project:

- **Project Name**: The name of the project from Monday.com
- **Status**: Current status of the project
- **Priority**: Project priority level
- **Assignee**: Person assigned to the project

## Logging

The bot uses Winston for logging with the following features:

- Console output for development
- File-based logging (`combined.log` and `error.log`)
- Configurable log levels
- Timestamp and structured logging

## Error Handling

- API errors are logged and reported to Slack
- Graceful shutdown on SIGINT and SIGTERM
- Automatic retry mechanisms for transient failures

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues and questions, please create an issue in the repository.
