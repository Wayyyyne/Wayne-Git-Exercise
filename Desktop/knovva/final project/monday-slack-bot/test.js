require('dotenv').config();
const { MondaySlackBot } = require('./index');

async function testBot() {
  try {
    console.log('Testing Monday-Slack Bot...');
    
    const bot = new MondaySlackBot();
    
    // Test manual update
    console.log('Triggering manual update...');
    await bot.triggerManualUpdate();
    
    console.log('Test completed successfully!');
  } catch (error) {
    console.error('Test failed:', error.message);
    process.exit(1);
  }
}

// Run test if this file is executed directly
if (require.main === module) {
  testBot();
} 