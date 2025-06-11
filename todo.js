/*const fs = require('fs');

let tasks = [];


const commands = process.argv[2];
const args = process.argv.slice(3);



switch(commands){
    case 'add' :
        tasks.push({
            task : args,
            status : 'not done'
        }
        );

        break;

    case 'list' :
        for(let i = 0; i < tasks.length; i++){
            console.log(`list ${i} : ${tasks[i].task} , ${tasks[i].status} `);
        }
        break;
    
    case 'done' :
        tasks[args[0]-1].status = `completed`;
  
        break;
    
    case 'delete':
        const removed = tasks.splice(args[0]-1,1);
        console.log(`alreday removed : ${removed}`);
      
        break;
    
    default:
        console.log('invalid commands');


}
*/

const chalk = require('chalk');
console.log(chalk.blue('Hello world!'));

const timestamp = require('time-stamp');

const fs = require('fs');
const FILE = 'todo.json';



let tasks = [];
if (fs.existsSync(FILE)) {
  tasks = JSON.parse(fs.readFileSync(FILE));
}

const commands = process.argv[2];  
const args = process.argv.slice(3);

function saveTasks() {
  fs.writeFileSync(FILE, JSON.stringify(tasks, null, 2));
}

switch(commands){
    case 'add':
        
        tasks.push({
            task: args.join(' '),
            status: 'not done',
            timestamp : timestamp()
        });
        saveTasks();
        break;

    case 'list':
        
        for(let i = 0; i < tasks.length; i++){
            console.log(chalk.blue(`list ${i+1}: ${tasks[i].task}, ${tasks[i].status}, ${tasks[i].timestamp}`));
        }
        break;
    
    case 'done':
        
        tasks[args[0]-1].status = `completed`;
        saveTasks();
        break;
    
    case 'delete':
        
        const removed = tasks.splice(args[0]-1 ,1);
        saveTasks();
        console.log(chalk.blue(`already removed: ${removed[0] ? removed[0].task : 'none'}`));
        break;
    
    case 'undo_last_command':
        /*
        pseudo node
        two method : pushstack() -- whenever receive certain method other tack
        popstack() -- whenever receive 
        */
    
    default:
        console.log(chalk.red('Invalid command.\n'));
        console.log(chalk.yellow('Usage:'));
        console.log('  node todo.js add "Your task here"');
        console.log('  node todo.js list');
        console.log('  node todo.js done <task number>');
        console.log('  node todo.js delete <task number>');
    break;
}