const { App } = require('@slack/bolt');
require('dotenv').config();
const axios = require('axios');
const cron = require('node-cron');

// Initialize Bolt app with Socket Mode
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
});

// Monday.com API config
const MONDAY_API_URL = 'https://api.monday.com/v2';
const MONDAY_HEADERS = {
  'Authorization': process.env.MONDAY_API_TOKEN,
  'Content-Type': 'application/json',
};

// Helper: Fetch all board IDs accessible to the user
async function fetchAllBoardIds() {
  const query = `query { boards { id name } }`;
  const response = await axios.post(MONDAY_API_URL, { query }, { headers: MONDAY_HEADERS });
  return response.data.data.boards.map(b => ({ id: b.id, name: b.name }));
}

// Helper: Fetch all tasks from a board, including subitems
async function fetchTasksFromBoard(boardId) {
  const query = `
    query {
      boards(ids: ${boardId}) {
        items_page(limit: 50) {
          items {
            id
            name
            column_values {
              id
              value
              text
              type
            }
            subitems {
              id
              name
              column_values {
                id
                value
                text
                type
              }
            }
          }
        }
      }
    }
  `;
  try {
    const response = await axios.post(MONDAY_API_URL, { query }, { headers: MONDAY_HEADERS });
    return response.data.data.boards[0]?.items_page.items || [];
  } catch (error) {
    if (error.response && error.response.data) {
      console.error('Monday API error:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Monday API error:', error);
    }
    throw error;
  }
}

// Helper: Fetch all tasks from all boards
async function fetchAllTasks() {
  const boards = await fetchAllBoardIds();
  let allTasks = [];
  for (const board of boards) {
    const tasks = await fetchTasksFromBoard(board.id);
    // Attach board name to each task for context
    allTasks = allTasks.concat(tasks.map(t => ({ ...t, _boardName: board.name })));
  }
  return allTasks;
}

// Helper: Categorize tasks
function categorizeTasks(tasks) {
  const completed = [];
  const inProgress = [];
  const workingOnIt = [];
  const notStarted = [];
  const stuck = [];
  for (const task of tasks) {
    const statusCol = task.column_values.find(col =>
      (col.id && col.id.toLowerCase() === 'status') ||
      (col.type && col.type.toLowerCase() === 'status')
    );
    const status = statusCol ? (statusCol.text ? statusCol.text.toLowerCase() : '') : '';
    if (status.includes('done') || status.includes('complete')) completed.push(task);
    else if (status.includes('stuck')) stuck.push(task);
    else if (status.includes('working on it')) workingOnIt.push(task);
    else if (status.includes('in progress') || status.includes('progress')) inProgress.push(task);
    else notStarted.push(task);
  }
  return { completed, inProgress, workingOnIt, notStarted, stuck };
}

// Helper: Get status emoji for a task
function getStatusEmoji(task) {
  const statusCol = task.column_values.find(col =>
    (col.id && col.id.toLowerCase() === 'status') ||
    (col.type && col.type.toLowerCase() === 'status')
  );
  const status = statusCol ? (statusCol.text ? statusCol.text.toLowerCase() : '') : '';
  if (status.includes('done') || status.includes('complete')) return '✅';
  if (status.includes('working on it')) return '🟡';
  if (status.includes('in progress') || status.includes('progress')) return '🚧';
  if (status.includes('stuck')) return '⛔';
  return '🕒';
}

// Helper: Format due date in color (Slack markdown)
function getDueDateColored(task) {
  const dateCol = task.column_values.find(col =>
    (col.id && col.id.toLowerCase() === 'date') ||
    (col.type && col.type.toLowerCase() === 'date')
  );
  if (!dateCol || !dateCol.text) return '';
  // Red for overdue, green for future, default for today (simple version)
  const today = new Date();
  const due = new Date(dateCol.text);
  let color = '#36a64f'; // green
  if (due < today.setHours(0,0,0,0)) color = '#e01e5a'; // red
  return ` (Due: *<!date^${Math.floor(due.getTime()/1000)}^{date_short}|${dateCol.text}>*)`;
}

// Recursive function to format item and its subitems
function formatHierarchicalTaskList(items, statusFilter, indent = 0) {
  let lines = [];
  const prefix = indent === 0 ? '•' : '   '.repeat(indent - 1) + (indent > 0 ? '├' : '');
  for (const item of items) {
    const emoji = getStatusEmoji(item);
    // Only include items matching the statusFilter
    if (statusFilter && getStatusEmoji(item) !== statusFilter) continue;
    let line = `${prefix} ${item.name}`;
    line += getDueDateColored(item);
    line += ` – ${emoji}`;
    lines.push(line);
    if (item.subitems && item.subitems.length > 0) {
      lines = lines.concat(formatHierarchicalTaskList(item.subitems, statusFilter, indent + 1));
    }
  }
  return lines.join('\n');
}

// Helper: Format task list for Slack
function formatTaskList(tasks) {
  if (!tasks.length) return '_None._';
  return tasks.map(t => `*${t.name}*${getAssigneeText(t)}${getDueDateText(t)}${getBoardNameText(t)}`).join('\n');
}
function getAssigneeText(task) {
  const assigneeCol = task.column_values.find(col =>
    (col.id && col.id.toLowerCase() === 'person') ||
    (col.type && col.type.toLowerCase() === 'people')
  );
  return assigneeCol && assigneeCol.text ? ` (Assignee: ${assigneeCol.text})` : '';
}
function getDueDateText(task) {
  const dateCol = task.column_values.find(col =>
    (col.id && col.id.toLowerCase() === 'date') ||
    (col.type && col.type.toLowerCase() === 'date')
  );
  return dateCol && dateCol.text ? ` (Due: ${dateCol.text})` : '';
}
function getBoardNameText(task) {
  return task._boardName ? ` _(Board: ${task._boardName})_` : '';
}

// 递归展开所有子项
function flattenItems(item) {
  let all = [item];
  if (item.subitems && item.subitems.length > 0) {
    for (const sub of item.subitems) {
      all = all.concat(flattenItems(sub));
    }
  }
  return all;
}

// Helper: Check if an item and all its subitems are complete
function isFullyComplete(item) {
  const isDone = getStatusEmoji(item) === '✅';
  if (item.subitems && item.subitems.length > 0) {
    return isDone && item.subitems.every(isFullyComplete);
  }
  return isDone;
}

// Helper: Check if an item or any subitem is not complete
function isNotFullyComplete(item) {
  if (getStatusEmoji(item) !== '✅') return true;
  if (item.subitems && item.subitems.length > 0) {
    return item.subitems.some(isNotFullyComplete);
  }
  return false;
}

// Helper: Check if an item and all its subitems are a specific status
function isFullyStatus(item, statusEmoji) {
  const isMatch = getStatusEmoji(item) === statusEmoji;
  if (item.subitems && item.subitems.length > 0) {
    return isMatch && item.subitems.every(sub => isFullyStatus(sub, statusEmoji));
  }
  return isMatch;
}

// Helper: Check if an item or any subitem is a specific status
function hasAnyStatus(item, statusEmoji) {
  if (getStatusEmoji(item) === statusEmoji) return true;
  if (item.subitems && item.subitems.length > 0) {
    return item.subitems.some(sub => hasAnyStatus(sub, statusEmoji));
  }
  return false;
}

// Helper: Format a single item and all subitems, always showing all subitems with correct status
function formatItemWithSubitemsStatus(item, statusEmoji, indent = 0) {
  let lines = [];
  // 只在 Completed 分支下严格筛选
  if (statusEmoji === '✅') {
    if (!isFullyStatus(item, '✅')) return lines;
  } else {
    // 只要父项或任一子项有该状态就显示父项
    if (getStatusEmoji(item) !== statusEmoji && !(item.subitems && item.subitems.some(sub => hasAnyStatus(sub, statusEmoji)))) return lines;
  }
  const prefix = indent === 0 ? '•' : '   '.repeat(indent - 1) + (indent > 0 ? (indent === 1 ? '├' : '│') : '');
  let line = `${prefix} ${item.name}`;
  line += getDueDateColored(item);
  line += ` – ${getStatusEmoji(item)}`;
  lines.push(line);
  if (item.subitems && item.subitems.length > 0) {
    for (let i = 0; i < item.subitems.length; i++) {
      const sub = item.subitems[i];
      // ✅ 分支下只显示全部完成的子项，其它分支下显示所有子项
      if (statusEmoji === '✅') {
        if (!isFullyStatus(sub, '✅')) continue;
      }
      const isLast = i === item.subitems.length - 1;
      const subPrefix = '   '.repeat(indent) + (isLast ? '└' : '├');
      let subLine = `${subPrefix} ${sub.name}`;
      subLine += getDueDateColored(sub);
      subLine += ` – ${getStatusEmoji(sub)}`;
      lines.push(subLine);
      if (sub.subitems && sub.subitems.length > 0) {
        lines = lines.concat(formatItemWithSubitemsStatus(sub, statusEmoji, indent + 2));
      }
    }
  }
  return lines;
}

// New summary formatter: four sections for each status
function formatMergedSummary(boardName, items) {
  let blocks = [];
  blocks.push({ type: 'header', text: { type: 'plain_text', text: `📊 ${boardName}` } });

  // Completed section
  let completedLines = [];
  items.forEach(item => {
    completedLines = completedLines.concat(formatItemWithSubitemsStatus(item, '✅'));
  });
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*✅ Completed:*\n${completedLines.length ? completedLines.join('\n') : '_None._'}` } });

  // Working on it section
  let workingLines = [];
  items.forEach(item => {
    workingLines = workingLines.concat(formatItemWithSubitemsStatus(item, '🟡'));
  });
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*🟡 Working on it:*\n${workingLines.length ? workingLines.join('\n') : '_None._'}` } });

  // Stuck section
  let stuckLines = [];
  items.forEach(item => {
    stuckLines = stuckLines.concat(formatItemWithSubitemsStatus(item, '⛔'));
  });
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*⛔ Stuck:*\n${stuckLines.length ? stuckLines.join('\n') : '_None._'}` } });

  // Not Started section
  let notStartedLines = [];
  items.forEach(item => {
    notStartedLines = notStartedLines.concat(formatItemWithSubitemsStatus(item, '🕒'));
  });
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*🕒 Not Started:*\n${notStartedLines.length ? notStartedLines.join('\n') : '_None._'}` } });

  return blocks;
}

// 修改 sendSummaryToChannel，使用合并 summary
async function sendSummaryToChannel(client, channel, boardId) {
  const boardList = await fetchAllBoardIds();
  const board = boardList.find(b => b.id === boardId);
  const items = await fetchTasksFromBoard(boardId);
  const blocks = formatMergedSummary(board?.name || 'Board', items);
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `Last updated: ${new Date().toLocaleString('en-US', { timeZone: process.env.TIMEZONE || 'America/New_York' })}` }] });
  await client.chat.postMessage({
    channel,
    text: 'Project Summary',
    blocks
  });
}

// Beautiful get_stuck message for a board
async function sendGetStuckToChannel(client, channel, boardId) {
  const boardList = await fetchAllBoardIds();
  const board = boardList.find(b => b.id === boardId);
  const tasks = (await fetchTasksFromBoard(boardId)).map(t => ({ ...t, _boardName: board?.name }));
  const { stuck, inProgress, notStarted, workingOnIt } = categorizeTasks(tasks);
  const unfinished = [...stuck, ...inProgress, ...workingOnIt, ...notStarted];
  await client.chat.postMessage({
    channel,
    text: 'Unfinished Tasks',
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `🚩 Unfinished Tasks (${board?.name || 'Board'})` } },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: formatTaskList(unfinished) } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `Last updated: ${new Date().toLocaleString('en-US', { timeZone: process.env.TIMEZONE || 'America/New_York' })}` }] },
    ],
  });
}

// Beautiful summary message
async function sendSummary(say) {
  const tasks = await fetchAllTasks();
  const { completed, inProgress, workingOnIt, notStarted } = categorizeTasks(tasks);
  await say({
    text: 'Project Summary',
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: '📊 Project Summary (All Boards)' } },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: `*✅ Completed Tasks:*\n${formatTaskList(completed)}` } },
      { type: 'section', text: { type: 'mrkdwn', text: `*🚧 In Progress:*\n${formatTaskList(inProgress)}` } },
      { type: 'section', text: { type: 'mrkdwn', text: `*🟡 Working on it:*\n${formatTaskList(workingOnIt)}` } },
      { type: 'section', text: { type: 'mrkdwn', text: `*🕒 Not Started:*\n${formatTaskList(notStarted)}` } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `Last updated: ${new Date().toLocaleString('en-US', { timeZone: process.env.TIMEZONE || 'America/New_York' })}` }] },
    ],
  });
}

// Beautiful get_stuck message
async function sendGetStuck(say) {
  const tasks = await fetchAllTasks();
  const { stuck, inProgress, notStarted, workingOnIt } = categorizeTasks(tasks);
  const unfinished = [...stuck, ...inProgress, ...workingOnIt, ...notStarted];
  await say({
    text: 'Unfinished Tasks',
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: '🚩 Unfinished Tasks (All Boards)' } },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: formatTaskList(unfinished) } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `Last updated: ${new Date().toLocaleString('en-US', { timeZone: process.env.TIMEZONE || 'America/New_York' })}` }] },
    ],
  });
}

// Slash Command Handler for /monday
app.command('/monday', async ({ ack, body, client }) => {
  await ack();
  // Fetch all boards
  const boards = await fetchAllBoardIds();
  // Filter out subitems boards
  const filteredBoards = boards.filter(b => !b.name.startsWith('Subitems of'));
  const boardOptions = filteredBoards.map(b => ({
    text: { type: 'plain_text', text: b.name },
    value: b.id
  }));
  // Open a modal to select board and action
  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: 'modal',
      callback_id: 'choose_board_action_modal',
      title: { type: 'plain_text', text: 'Monday Bot' },
      submit: { type: 'plain_text', text: 'Next' },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [
        {
          type: 'input',
          block_id: 'board_block',
          label: { type: 'plain_text', text: 'Select Monday Board' },
          element: {
            type: 'static_select',
            action_id: 'board_select',
            options: boardOptions
          }
        },
        {
          type: 'input',
          block_id: 'action_block',
          label: { type: 'plain_text', text: 'Choose Action' },
          element: {
            type: 'static_select',
            action_id: 'action_select',
            options: [
              { text: { type: 'plain_text', text: 'Summary' }, value: 'summary' },
              { text: { type: 'plain_text', text: 'Get Stuck' }, value: 'get_stuck' },
              { text: { type: 'plain_text', text: 'Set Scheduled Reminder' }, value: 'set_reminder' },
              { text: { type: 'plain_text', text: 'View/Cancel Scheduled Reminders' }, value: 'view_reminders' }
            ]
          }
        }
      ]
    }
  });
});

// Modal Submission Handler (Board/Action → Channel)
app.view('choose_board_action_modal', async ({ ack, view, body, client }) => {
  await ack();
  const boardId = view.state.values.board_block.board_select.selected_option.value;
  const action = view.state.values.action_block.action_select.selected_option.value;
  if (action === 'set_reminder') {
    // Fetch all channels
    const result = await client.conversations.list({ types: 'public_channel,private_channel' });
    const options = result.channels.map(ch => ({
      text: { type: 'plain_text', text: `#${ch.name}` },
      value: ch.id
    }));
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'set_reminder_modal',
        private_metadata: JSON.stringify({ boardId }),
        title: { type: 'plain_text', text: 'Set Scheduled Reminder' },
        submit: { type: 'plain_text', text: 'Save' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          {
            type: 'input',
            block_id: 'frequency_block',
            label: { type: 'plain_text', text: 'Frequency' },
            element: {
              type: 'static_select',
              action_id: 'frequency_select',
              options: [
                { text: { type: 'plain_text', text: 'Daily' }, value: 'daily' },
                { text: { type: 'plain_text', text: 'Weekly (Monday)' }, value: 'weekly' }
              ]
            }
          },
          {
            type: 'input',
            block_id: 'time_block',
            label: { type: 'plain_text', text: 'Time (HH:MM, 24h)' },
            element: {
              type: 'plain_text_input',
              action_id: 'time_input',
              placeholder: { type: 'plain_text', text: 'e.g. 09:00' }
            }
          },
          {
            type: 'input',
            block_id: 'channel_block',
            label: { type: 'plain_text', text: 'Choose a channel:' },
            element: {
              type: 'static_select',
              action_id: 'channel_select',
              options
            }
          }
        ]
      }
    });
    return;
  }
  if (action === 'view_reminders') {
    // Show all scheduled reminders with delete buttons
    let blocks = [];
    if (scheduledReminders.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'plain_text', text: 'No scheduled reminders.' }
      });
    } else {
      scheduledReminders.forEach((rem, idx) => {
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: `*${idx + 1}.* Board: ${rem.boardId}, Channel: <#${rem.channel}>, Cron: \`${rem.cronExp}\`` },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: 'Delete' },
            style: 'danger',
            action_id: `delete_reminder_${idx}`
          }
        });
      });
    }
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'manage_reminders_modal',
        title: { type: 'plain_text', text: 'Manage Reminders' },
        close: { type: 'plain_text', text: 'Close' },
        blocks
      }
    });
    return;
  }
  // Fetch all channels
  const result = await client.conversations.list({ types: 'public_channel,private_channel' });
  const options = result.channels.map(ch => ({
    text: { type: 'plain_text', text: `#${ch.name}` },
    value: ch.id
  }));
  // Open a modal to select channel
  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: 'modal',
      callback_id: 'choose_channel_modal',
      private_metadata: JSON.stringify({ boardId, action }),
      title: { type: 'plain_text', text: 'Select Channel' },
      submit: { type: 'plain_text', text: 'Send' },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [
        {
          type: 'input',
          block_id: 'channel_block',
          label: { type: 'plain_text', text: 'Choose a channel:' },
          element: {
            type: 'static_select',
            action_id: 'channel_select',
            options
          }
        }
      ]
    }
  });
});

// Final Modal Submission Handler (Post to Channel)
app.view('choose_channel_modal', async ({ ack, view, client }) => {
  await ack();
  const { boardId, action } = JSON.parse(view.private_metadata);
  const channel = view.state.values.channel_block.channel_select.selected_option.value;
  if (action === 'summary') {
    await sendSummaryToChannel(client, channel, boardId);
  } else {
    await sendGetStuckToChannel(client, channel, boardId);
  }
});

// In-memory reminder storage (for demo)
const scheduledReminders = [];

// Handle reminder modal submission with time validation and error feedback
app.view('set_reminder_modal', async ({ ack, view, client, body }) => {
  const { boardId } = JSON.parse(view.private_metadata);
  const frequency = view.state.values.frequency_block.frequency_select.selected_option.value;
  const time = view.state.values.time_block.time_input.value;
  const channel = view.state.values.channel_block.channel_select.selected_option.value;
  // Validate time format (HH:MM 24h)
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    await ack({
      response_action: 'errors',
      errors: {
        time_block: 'Please enter time in HH:MM 24-hour format, e.g. 09:00'
      }
    });
    return;
  }
  await ack();
  // Parse time
  const [hour, minute] = time.split(':');
  let cronExp = '';
  if (frequency === 'daily') {
    cronExp = `${minute} ${hour} * * *`;
  } else {
    cronExp = `${minute} ${hour} * * 1`;
  }
  try {
    // Schedule the reminder
    const job = cron.schedule(cronExp, async () => {
      await sendGetStuckToChannel(client, channel, boardId);
    }, {
      timezone: process.env.TIMEZONE || 'UTC'
    });
    scheduledReminders.push({ boardId, channel, cronExp, job });
    // Confirmation
    await client.chat.postMessage({
      channel,
      text: `⏰ Scheduled reminder set! A get stuck summary will be sent ${frequency === 'daily' ? 'every day' : 'every Monday'} at ${time}.`
    });
  } catch (err) {
    await client.chat.postMessage({
      channel: body.user.id,
      text: `❌ Failed to set scheduled reminder. Please try again.`
    });
  }
});

// Handle delete reminder button
app.action(/delete_reminder_\d+/, async ({ ack, body, action, client }) => {
  await ack();
  const idx = parseInt(action.action_id.replace('delete_reminder_', ''), 10);
  if (scheduledReminders[idx]) {
    scheduledReminders[idx].job.stop();
    scheduledReminders.splice(idx, 1);
    // Refresh modal
    let blocks = [];
    if (scheduledReminders.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'plain_text', text: 'No scheduled reminders.' }
      });
    } else {
      scheduledReminders.forEach((rem, i) => {
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: `*${i + 1}.* Board: ${rem.boardId}, Channel: <#${rem.channel}>, Cron: \`${rem.cronExp}\`` },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: 'Delete' },
            style: 'danger',
            action_id: `delete_reminder_${i}`
          }
        });
      });
    }
    await client.views.update({
      view_id: body.view.id,
      view: {
        type: 'modal',
        callback_id: 'manage_reminders_modal',
        title: { type: 'plain_text', text: 'Manage Reminders' },
        close: { type: 'plain_text', text: 'Close' },
        blocks
      }
    });
  }
});

(async () => {
  try {
    await app.start(process.env.PORT || 3000);
    console.log('⚡️ Bolt app is running!');
  } catch (err) {
    console.error('App failed to start:', err);
  }
})();