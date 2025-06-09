require('dotenv').config();
const { Telegraf } = require('telegraf');
const { v4: uuidv4 } = require('uuid');
const { createCanvas } = require('canvas');
//const GIFEncoder = require('gifencoder');
const GifEncoder = require('gif-encoder');
const { Readable } = require('stream');
const fs = require('fs');
const Redis = require('ioredis');
const { Pool } = require('pg');
const Queue = require('bull');
const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { validatePaymentVerification } = require('razorpay/dist/utils/razorpay-utils');
const axios = require('axios');
//import { validatePaymentVerification } from 'razorpay/dist/utils/razorpay-utils';
console.log('Starting bot');

// Initialize Express server
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/search', express.static('public'));

// Initialize bot and connections
const bot = new Telegraf(process.env.BOT_TOKEN || '7509229486:AAF-UOnOzMeMBp9bxTClneODYHKhDrAF0OQ');
const bot_timer_1 = new Telegraf(process.env.BOT_TIMER_TOKEN_1 || '8126051988:AAGoe3dLRp9AWPlaOJJ1MQFKWWMOE30otAA');
const bot_timer_2 = new Telegraf(process.env.BOT_TIMER_TOKEN_2 || '8144697142:AAGQh_vIlJoJhhc_R-Qo--e3NoWIRu_1wCc');
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/quizbot',
  max: 20
});
const callbackQueue = new Queue('callback_queries', process.env.REDIS_URL || 'redis://localhost:6379');
const callbackQueue2 = new Queue('callback_queries2', process.env.REDIS_URL || 'redis://localhost:6379');
const CHANNEL_CHAT_ID = process.env.CHANNEL_CHAT_ID || '-1002569196425';
const CHANNEL_URL = process.env.CHANNEL_URL || 't.me/+Yv2wqr3JpIljYmY1'; // Add to .env, e.g., t.me/+randomString for private channels
const RAZORPAY_API_URL = 'https://api.razorpay.com/v1/payout-links';
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

app.post('/webhook', bot.webhookCallback('/webhook'));

// Start Express server
app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
});

// Error handling
process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});

async function generateCountdownGIF() {
    const width = 200;
    const height = 200;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    //const encoder = new GIFEncoder(width, height);
	const encoder = new GifEncoder({ width, height });

    // Create a buffer stream
    const chunks = [];
    const stream = new Readable({
        read() {}
    });
		
    /*encoder.createReadStream().on('data', chunk => chunks.push(chunk)).on('end', () => {
        stream.push(Buffer.concat(chunks));
        stream.push(null);
    });*/
	
	encoder.on('data', chunk => chunks.push(chunk));
    encoder.on('end', () => {
        stream.push(Buffer.concat(chunks));
        stream.push(null);
    });
	
    /*encoder.start();
    encoder.setRepeat(0); // 0 for no repeat
    encoder.setDelay(1000); // 1 second per frame
    encoder.setQuality(10);*/
	
	encoder.writeHeader();
    encoder.setRepeat(-1); // 0 for repeat, -1 for no-repeat
    encoder.setDelay(1000); // Frame delay in ms
    encoder.setQuality(10); // Image quality, 10 is default

    for (let i = 10; i >= 0; i--) {
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = 'white';
        ctx.font = 'bold 80px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(i.toString(), width / 2, height / 2);
		
		ctx.strokeStyle = 'black';
        ctx.lineWidth = 2;
        ctx.strokeRect(50, 50, 100, 100);
		const imageData = ctx.getImageData(0, 0, width, height).data; // Extract RGBA pixels
        
		encoder.addFrame(imageData);
		
        //encoder.addFrame(ctx);
    }

    encoder.finish();
    return stream;
}

// Express routes
app.get('/api/search', async (req, res) => {
  const userId = req.query.userId;
  if (!userId) {
    return res.status(400).json({ error: 'User ID required' });
  }
  const cached = await redis.get(`search:cache:${userId}`);
  const state = cached ? JSON.parse(cached) : await redis.hgetall(`user:states:${userId}`);
  if (!state.userId) {
    return res.status(404).json({ error: 'User not found' });
  }
  if (!cached) {
    await redis.setex(`search:cache:${userId}`, 120, JSON.stringify(state));
  }
  res.json({
    userId,
    wallet: parseFloat(state.wallet || 0).toFixed(2),
    bid: parseFloat(state.bid || 0).toFixed(2),
    raise: parseFloat(state.raise || 0).toFixed(2),
    winpercent: parseFloat(state.winpercent || 0).toFixed(2),
    winnings: parseFloat(state.winnings || 0).toFixed(2),
    priority_order: state.priority_order || ''
  });
});

// Mock payment gateway
const paymentGateway = {
  createDepositLink: async (userId, amount) => {
    return `https://payment.example.com/deposit?user=${userId}&amount=${amount}&txid=${uuidv4()}`;
  },
  processWithdrawal: async (userId, amount, details) => {
    console.log(`Withdrawal: user=${userId}, amount=${amount}, details=${details}`);
    return true;
  }
};

bot.start(async (ctx) => {
  const userId = ctx.from.id.toString();
  await redis.sadd('channel:subscribers', userId);
  await initializeSubscribers();
  ctx.reply(`Welcome! Your userID: ${userId}\nMust be 18+. Check channel or use /balance, /deposit, /withdraw, /history.`, {
    reply_markup: {
      inline_keyboard: [[{ text: 'Join Quiz', callback_data: 'join_quiz' }]]
    }
  });
});

bot.action('view_stats1', async (ctx) => {
  //try {
    const userId = ctx.from.id.toString();
    //const miniAppUrl = `${process.env.MINI_APP_URL || 'https://your-bot.com/search'}?userId=${userId}`;
	
	//const cached = await redis.get(`search:cache:${userId}`);
  //const state = cached ? JSON.parse(cached) : await redis.hgetall(`user:states:${userId}`);
  const state = await redis.hgetall(`user:states:${userId}`);
  if (!state.userId) {
	  //return;
    //return res.status(404).json({ error: 'User not found' });
  }
  //if (!cached) {
    //await redis.setex(`search:cache:${userId}`, 120, JSON.stringify(state));
  //}
  /*var str1 = json({
    userId,
    wallet: parseFloat(state.wallet || 0).toFixed(2),
    bid: parseFloat(state.bid || 0).toFixed(2),
    raise: parseFloat(state.raise || 0).toFixed(2),
    winpercent: parseFloat(state.winpercent || 0).toFixed(2),
    winnings: parseFloat(state.winnings || 0).toFixed(2),
    priority_order: state.priority_order || ''
  });*/
  
  //var str2 = JSON.stringify(state);
  var str2 = `Wallet : ${state.wallet}`;

	await bot.telegram.callApi('answerCallbackQuery', {
        callback_query_id: ctx.callbackQuery.id,
        text: str2,
		show_alert: true
      });

    // Answer callback query and open Web App
    /*await ctx.answerCallbackQuery({
      url: miniAppUrl,
    });*/
	//await bot.telegram.callApi('answerCallbackQuery', {
        //url: miniAppUrl,
    //});
  //} catch (error) {
    //console.error('Error handling view_stats callback:', error);
    //await bot.telegram.callApi('answerCallbackQuery', {
      //text: 'Error opening stats. Please try again.',
      //show_alert: true,
    //});
  //}
});

bot.action('view_stats2', async (ctx) => {
  //try {
    const userId = ctx.from.id.toString();
    //const miniAppUrl = `${process.env.MINI_APP_URL || 'https://your-bot.com/search'}?userId=${userId}`;
	
	const cached = await redis.get(`search:cache:${userId}`);
    const state = cached ? JSON.parse(cached) : await redis.hgetall(`user:states:${userId}`);
  
  //const state = await redis.hgetall(`user:states:${userId}`);
  
  //if (!state.userId) {
	  //return;
    //return res.status(404).json({ error: 'User not found' });
  //}
  //if (!cached) {
    //await redis.setex(`search:cache:${userId}`, 120, JSON.stringify(state));
  //}
  /*var str1 = json({
    userId,
    wallet: parseFloat(state.wallet || 0).toFixed(2),
    bid: parseFloat(state.bid || 0).toFixed(2),
    raise: parseFloat(state.raise || 0).toFixed(2),
    winpercent: parseFloat(state.winpercent || 0).toFixed(2),
    winnings: parseFloat(state.winnings || 0).toFixed(2),
    priority_order: state.priority_order || ''
  });*/
  
  //var str2 = JSON.stringify(state);
  var str2 = `Bid : ${state.bid}\nWallet : ${state.wallet}`;

	await bot.telegram.callApi('answerCallbackQuery', {
        callback_query_id: ctx.callbackQuery.id,
        text: str2,
		show_alert: true
      });

    // Answer callback query and open Web App
    /*await ctx.answerCallbackQuery({
      url: miniAppUrl,
    });*/
	//await bot.telegram.callApi('answerCallbackQuery', {
        //url: miniAppUrl,
    //});
  //} catch (error) {
    //console.error('Error handling view_stats callback:', error);
    //await bot.telegram.callApi('answerCallbackQuery', {
      //text: 'Error opening stats. Please try again.',
      //show_alert: true,
    //});
  //}
});

bot.action('view_stats3', async (ctx) => {
  //try {
    const userId = ctx.from.id.toString();
    //const miniAppUrl = `${process.env.MINI_APP_URL || 'https://your-bot.com/search'}?userId=${userId}`;
	
	const cached = await redis.get(`search:cache:${userId}`);
  const state = cached ? JSON.parse(cached) : await redis.hgetall(`user:states:${userId}`);
  //const state = await redis.hgetall(`user:states:${userId}`);
  
  //if (!state.userId) {
	  //return;
    //return res.status(404).json({ error: 'User not found' });
  //}
  //if (!cached) {
    //await redis.setex(`search:cache:${userId}`, 120, JSON.stringify(state));
  //}
  /*var str1 = json({
    userId,
    wallet: parseFloat(state.wallet || 0).toFixed(2),
    bid: parseFloat(state.bid || 0).toFixed(2),
    raise: parseFloat(state.raise || 0).toFixed(2),
    winpercent: parseFloat(state.winpercent || 0).toFixed(2),
    winnings: parseFloat(state.winnings || 0).toFixed(2),
    priority_order: state.priority_order || ''
  });*/
  
  //var str2 = JSON.stringify(state);
  //var priority_order = await redis.hget(`response:${userId}:${gameState.cycleId}`, 'priority_order');
  var str2 = `Bid : ${state.bid}\nRaise : ${state.raise}\nAnswer : ${state.priority_order}\nWin Percent : ${state.winpercent}\nWinnings : ${state.winnings}\nWallet : ${state.wallet}`;

	await bot.telegram.callApi('answerCallbackQuery', {
        callback_query_id: ctx.callbackQuery.id,
        text: str2,
		show_alert: true
      });

    // Answer callback query and open Web App
    /*await ctx.answerCallbackQuery({
      url: miniAppUrl,
    });*/
	//await bot.telegram.callApi('answerCallbackQuery', {
        //url: miniAppUrl,
    //});
  //} catch (error) {
    //console.error('Error handling view_stats callback:', error);
    //await bot.telegram.callApi('answerCallbackQuery', {
      //text: 'Error opening stats. Please try again.',
      //show_alert: true,
    //});
  //}
});


async function runCycle() {
	//const now = Date.now();
	
	//if (now%120000 == 0)
	//{
		//const miniAppUrl = `${process.env.MINI_APP_URL || 'https://your-bot.com/search'}?userId=${userId}`;
		
		
		/*try {
        const gifStream = await generateCountdownGIF();
        const messagegif = await bot.telegram.sendAnimation(
            CHANNEL_CHAT_ID,
            { source: gifStream, filename: 'countdown.gif', contentType: 'image/gif' },
            { caption: 'Countdown from 10 to 0' }
        );

        // Schedule deletion after 10 seconds
        setTimeout(async () => {
            try {
                await bot.telegram.deleteMessage(CHANNEL_CHAT_ID, messagegif.message_id);
                //ctx.reply('Countdown animation deleted from the channel.');
            } catch (error) {
                console.error('Error deleting message:', error);
                //ctx.reply('Failed to delete countdown animation.');
            }
        }, 10000); // 10 seconds

        //ctx.reply('Countdown animation sent to the channel!');
    } catch (error) {
        console.error('Error generating or sending GIF:', error);
        //ctx.reply('Failed to send countdown animation.');
    }*/
		
		//await new Promise(resolve => setTimeout(resolve, 118000-(Date.now()%120000)));
		
		/*timeLeft = parseInt((120000 - (Date.now()%120000))/1000);
		tmessage = await bot.telegram.sendMessage(CHANNEL_CHAT_ID, `Next game starting in ${timeLeft} seconds`);
		message_exists = true;
		interval = setInterval(async () => {
        timeLeft-=3;
        if (timeLeft < 0) {
			message_exists = false;
            //bot.telegram.deleteMessage(CHANNEL_CHAT_ID, tmessage.message_id);
			clearInterval(interval);
        }
        try {
			if (timeLeft >= 0 && message_exists) {
				bot.telegram.editMessageText(CHANNEL_CHAT_ID, tmessage.message_id, null, `Next game starting in ${timeLeft} seconds`);
			}
        } catch (error) {
            console.error('Error:', error);
        }
		}, 3000);*/
	
	    /*var strt = parseInt((120000-(Date.now()%120000))/1000);
		tmessage = await bot.telegram.sendMessage(CHANNEL_CHAT_ID, strt.toString());
		gameState.timerMessageId = tmessage.message_id;
		const interval = setInterval(() => {
			strt--;
			//if(parseInt((10000-(Date.now()%120000))) > 0){
				bot.telegram.editMessageText(CHANNEL_CHAT_ID, gameState.timerMessageId, null, strt.toString());
			//}
		}, 3000);*/
		
		timeLeft = parseInt((120000 - (Date.now()%120000))/1000);
		
		/*const gifStream = fs.createReadStream('10a.gif');
		fmessage = await bot.telegram.sendAnimation(
            CHANNEL_CHAT_ID,
            { source: gifStream, filename: '10a.gif', contentType: 'image/gif' }
        );*/
		
		//f1message = fmessage.animation.file_id;
		//await bot.telegram.sendAnimation(CHANNEL_CHAT_ID, f1message);
		//await bot.telegram.sendMessage(CHANNEL_CHAT_ID, `${f1message}`);
		
		/*await bot.telegram.sendAnimation(
            CHANNEL_CHAT_ID,
            { source: 'https://t.me/c/2569196425/1218', contentType: 'image/gif' },
            { caption: 'Countdown from 10 to 0' }
        );*/
		
		/*await bot.telegram.sendAnimation(
            CHANNEL_CHAT_ID,
            { animation: 'https://t.me/c/2569196425/1218', contentType: 'image/gif' },
            { caption: 'Countdown from 10 to 0' }
        );*/
		
		//await bot.telegram.sendMessage(CHANNEL_CHAT_ID, `Next game starting in ${timeLeft} seconds`);
		
		await bot.telegram.sendMessage(CHANNEL_CHAT_ID, `Next game starting in ${timeLeft} seconds`, disable_notification = true);
		
		await new Promise(resolve => setTimeout(resolve, 120000 - (Date.now()%120000)));
		
		//console.log(`${fmessage.message_id}`);
		
		//f1message = await bot.telegram.copyMessage(CHANNEL_CHAT_ID, CHANNEL_CHAT_ID, fmessage.message_id);
		//await bot.telegram.sendMessage(CHANNEL_CHAT_ID, f1message, disable_notification = true).catch(err => console.error('Error removing coin buttons:', err));
		
		//await bot.telegram.forwardMessage(CHANNEL_CHAT_ID, CHANNEL_CHAT_ID, fmessage.message_id);
		
		//f1message = fmessage.animation.file_id;
		//await bot.telegram.sendAnimation(CHANNEL_CHAT_ID, f1message);
		//await bot.telegram.sendMessage(CHANNEL_CHAT_ID, `${f1message}`);
		
		//await bot.telegram.sendMessage(CHANNEL_CHAT_ID, f1message, disable_notification = true).catch(err => console.error('Error removing coin buttons:', err));
		
		//await bot.telegram.deleteMessage(CHANNEL_CHAT_ID, tmessage.message_id);
		
		/*clearInterval(interval);
		await bot.telegram.deleteMessage(CHANNEL_CHAT_ID, gameState.timerMessageId);*/
		
		await initializeSubscribers();
		gameState.cycleStart = Date.now();
		gameState.cycleId = Math.floor(gameState.cycleStart / 1000).toString();
		gameState.prizePool = 0;
		gameState.coinMessageId = null;
		gameState.questionMessageId = null;
		gameState.raiseMessageId = null;
		gameState.currentQuiz = await getRandomQuestion();
		
		await redis.hmset(`quiz:cycles:${gameState.cycleId}`,
			'start_time', new Date(gameState.cycleStart).toISOString(),
			'prize_pool', 0
		);
		await redis.set('game:state', JSON.stringify(gameState));
		console.log(`startGameCycle: Cycle ${gameState.cycleId} initialized`);
		
		for (const userId of gameState.players) {
          const state = await redis.hgetall(`user:states:${userId}`);
          await redis.hmset(`user:states:${userId}`,
            'bid', 0,
            'raise', 0,
            'winpercent', 0,
            'winnings', 0,
            'wallet', state.wallet || 0,
            'userId', userId
          );
        }
		await bot.telegram.sendMessage(CHANNEL_CHAT_ID, `Game is starting. Click button below to check wallet balance.`, {
            reply_markup: {
            inline_keyboard: [
				[{ text: 'Wallet', callback_data: 'view_stats1' }],
				//[{ text: 'Click Me', url: process.env.MINI_APP_URL || 'https://your-bot.com/search' }],
				//[{ text: 'Click Me', switch_inline_query: "hello1" }],
				//[{ text: 'Click Me', switch_inline_query_chosen_chat: "hello2" }]
			]
          },
        }, disable_notification = true);
		
		/*var strt = parseInt((10000-(Date.now()%120000))/1000);
		tmessage = await bot.telegram.sendMessage(CHANNEL_CHAT_ID, strt.toString());
		gameState.timerMessageId = tmessage.message_id;
		const interval = setInterval(() => {
			strt--;
			//if(parseInt((10000-(Date.now()%120000))) > 0){
				bot.telegram.editMessageText(CHANNEL_CHAT_ID, gameState.timerMessageId, null, strt.toString());
			//}
		}, 1000);*/
		
		timeLeft = parseInt((10000 - (Date.now()%120000))/1000);
		tmessage = await bot_timer_2.telegram.sendMessage(CHANNEL_CHAT_ID, `${timeLeft}`);
		message_exists = true;
		interval = setInterval(async () => {
        timeLeft-=2;
        if (timeLeft < 0) {
			message_exists = false;
            //bot.telegram.deleteMessage(CHANNEL_CHAT_ID, tmessage.message_id);
			clearInterval(interval);
        }
        try {
			if (timeLeft >= 0 && message_exists) {
				await bot_timer_2.telegram.editMessageText(CHANNEL_CHAT_ID, tmessage.message_id, null, `${timeLeft}`);
			}
        } catch (error) {
            console.error('Error:', error);
        }
		}, 2000);
		
		await new Promise(resolve => setTimeout(resolve, 10000-(Date.now()%120000)));
		await bot.telegram.deleteMessage(CHANNEL_CHAT_ID, tmessage.message_id);
	//}
	
		/*clearInterval(interval);
		await bot.telegram.deleteMessage(CHANNEL_CHAT_ID, gameState.timerMessageId);*/
		//await bot.telegram.editMessageText(CHANNEL_CHAT_ID, gameState.timerMessageId, null, null);
	
	//if (now%120000 == 10000)
	//{
		//const messages = await generateTableMessages(false);
        const category = gameState.currentQuiz?.category || 'General';
        message = await bot.telegram.sendMessage(CHANNEL_CHAT_ID, `Select Bid\nUpcoming question category: ${category}`, {
            reply_markup: {
            inline_keyboard: [
              [{ text: '10', callback_data: 'select_coins_10' }],
              [{ text: '20', callback_data: 'select_coins_20' }],
              [{ text: '30', callback_data: 'select_coins_30' }],
              [{ text: '40', callback_data: 'select_coins_40' }]
            ]
          },
          }, disable_notification = true);
		  gameState.coinMessageId = message.message_id;
	//}
		//tmessage = await bot.telegram.sendAnimation(CHANNEL_CHAT_ID, process.env.FILE_ID_20, { contentType: 'image/gif' });
		//await bot.telegram.sendMessage(CHANNEL_CHAT_ID, f1message, disable_notification = true).catch(err => console.error('Error 1234', err));
		//tmessage = await bot.telegram.forwardMessage(CHANNEL_CHAT_ID, CHANNEL_CHAT_ID, process.env.FORWARD_MESSAGE_ID);
		
		/*strt = parseInt((30000-(Date.now()%120000))/1000);
		tmessage = await bot.telegram.sendMessage(CHANNEL_CHAT_ID, strt.toString());
		gameState.timerMessageId = tmessage.message_id;
		const interval1 = setInterval(() => {
			strt--;
			//if(parseInt((10000-(Date.now()%120000))) > 0){
				bot.telegram.editMessageText(CHANNEL_CHAT_ID, gameState.timerMessageId, null, strt.toString());
			//}
		}, 1000);*/
		
		timeLeft = parseInt((30000 - (Date.now()%120000))/1000);
		tmessage = await bot_timer_1.telegram.sendMessage(CHANNEL_CHAT_ID, `${timeLeft}`);
		message_exists = true;
		interval = setInterval(async () => {
        timeLeft-=2;
        if (timeLeft < 0) {
			message_exists = false;
            //bot.telegram.deleteMessage(CHANNEL_CHAT_ID, tmessage.message_id);
			clearInterval(interval);
        }
        try {
			if (timeLeft >= 0 && message_exists) {
				await bot_timer_1.telegram.editMessageText(CHANNEL_CHAT_ID, tmessage.message_id, null, `${timeLeft}`);
			}
        } catch (error) {
            console.error('Error:', error);
        }
		}, 2000);
	
		await new Promise(resolve => setTimeout(resolve, 30000-(Date.now()%120000)));
		await bot.telegram.deleteMessage(CHANNEL_CHAT_ID, tmessage.message_id);
		//await bot.telegram.deleteMessage(CHANNEL_CHAT_ID, tmessage.message_id);
	//if (now%120000 == 30000)
	//{
		/*await clearInterval(interval1);
		await bot.telegram.deleteMessage(CHANNEL_CHAT_ID, gameState.timerMessageId);*/
		
		await bot.telegram.editMessageReplyMarkup(CHANNEL_CHAT_ID, gameState.coinMessageId, null)
            .catch(err => console.error('Error removing coin buttons:', err));
		await processCoinSelections(gameState.cycleId);
		await bot.telegram.sendMessage(CHANNEL_CHAT_ID, `Bids closed. Click button below to check your bid and wallet status`, {
            reply_markup: {
            inline_keyboard: [
				//[{ text: 'Click Me', url: process.env.MINI_APP_URL || 'https://your-bot.com/search' }]
				[{ text: 'Check Bid', callback_data: 'view_stats2' }],
			]
          },
        }, disable_notification = true);
	//}
		await bot.telegram.sendMessage(CHANNEL_CHAT_ID, `Question coming`, disable_notification = true);
		//tmessage = await bot.telegram.sendAnimation(CHANNEL_CHAT_ID, process.env.FILE_ID_20, { contentType: 'image/gif' });
		//tmessage = await bot.telegram.forwardMessage(CHANNEL_CHAT_ID, CHANNEL_CHAT_ID, process.env.FORWARD_MESSAGE_ID);
		//await bot.telegram.sendMessage(CHANNEL_CHAT_ID, `${f1message}`, disable_notification = true).catch(err => console.error('Error 1234', err));
		/*timeLeft = parseInt((40000 - (Date.now()%120000))/1000);
		tmessage = await bot.telegram.sendMessage(CHANNEL_CHAT_ID, `${timeLeft}`);
		message_exists = true;
		interval = setInterval(async () => {
        timeLeft-=3;
        if (timeLeft < 0) {
			message_exists = false;
            //bot.telegram.deleteMessage(CHANNEL_CHAT_ID, tmessage.message_id);
			clearInterval(interval);
        }
        try {
			if (timeLeft >= 0 && message_exists) {
				bot.telegram.editMessageText(CHANNEL_CHAT_ID, tmessage.message_id, null, `${timeLeft}`);
			}
        } catch (error) {
            console.error('Error:', error);
        }
		}, 3000);*/
	
		//await new Promise(resolve => setTimeout(resolve, 40000-(Date.now()%120000)));
		
		//await bot.telegram.deleteMessage(CHANNEL_CHAT_ID, tmessage.message_id);
	//if (now%120000 == 40000)
	//{
		
		//await bot.telegram.sendMessage(CHANNEL_CHAT_ID, `Question coming`, disable_notification = true);
	//}
	
		/*timeLeft = parseInt((50000 - (Date.now()%120000))/1000);
		tmessage = await bot.telegram.sendMessage(CHANNEL_CHAT_ID, `${timeLeft}`);
		message_exists = true;
		interval = setInterval(async () => {
        timeLeft-=3;
        if (timeLeft < 0) {
			message_exists = false;
            //bot.telegram.deleteMessage(CHANNEL_CHAT_ID, tmessage.message_id);
			clearInterval(interval);
        }
        try {
			if (timeLeft >= 0 && message_exists) {
				bot.telegram.editMessageText(CHANNEL_CHAT_ID, tmessage.message_id, null, `${timeLeft}`);
			}
        } catch (error) {
            console.error('Error:', error);
        }
		}, 3000);*/
	
	await new Promise(resolve => setTimeout(resolve, 50000-(Date.now()%120000)));
	//await bot.telegram.deleteMessage(CHANNEL_CHAT_ID, tmessage.message_id);
	//await bot.telegram.deleteMessage(CHANNEL_CHAT_ID, tmessage.message_id);
	
	//if (now%120000 == 50000)
	//{
		const quiz = gameState.currentQuiz;
		message = await bot.telegram.sendMessage(CHANNEL_CHAT_ID, `Question: ${quiz.question}\n${quiz.options.join('\n')}\nSelect options in order of preference (e.g., D, C, A, B).`, {
            reply_markup: {
            inline_keyboard: [
              [
				{ text: 'A', callback_data: 'select_answer_A' },
                { text: 'B', callback_data: 'select_answer_B' },
                { text: 'C', callback_data: 'select_answer_C' },
                { text: 'D', callback_data: 'select_answer_D' }
			  ]
            ]
          },
        }, disable_notification = true);
		gameState.questionMessageId = message.message_id;
		//tmessage = await bot.telegram.sendAnimation(CHANNEL_CHAT_ID, process.env.FILE_ID_10, { contentType: 'image/gif' });
		//tmessage = await bot.telegram.forwardMessage(CHANNEL_CHAT_ID, CHANNEL_CHAT_ID, process.env.FORWARD_MESSAGE_ID_10);
	//}
	
		timeLeft = parseInt((60000 - (Date.now()%120000))/1000);
		tmessage = await bot_timer_2.telegram.sendMessage(CHANNEL_CHAT_ID, `${timeLeft} seconds`);
		message_exists = true;
		interval = setInterval(async () => {
        timeLeft-=1;
        if (timeLeft < 0) {
			message_exists = false;
            //bot.telegram.deleteMessage(CHANNEL_CHAT_ID, tmessage.message_id);
			clearInterval(interval);
        }
        try {
			if (timeLeft >= 0 && message_exists) {
				await bot_timer_2.telegram.editMessageText(CHANNEL_CHAT_ID, tmessage.message_id, null, `${timeLeft} seconds`);
			}
        } catch (error) {
            console.error('Error:', error);
        }
		}, 1000);
	
	await new Promise(resolve => setTimeout(resolve, 60000-(Date.now()%120000)));
	await bot.telegram.deleteMessage(CHANNEL_CHAT_ID, tmessage.message_id);
	//await bot.telegram.deleteMessage(CHANNEL_CHAT_ID, tmessage.message_id);
	//if (now%120000 == 60000)
	//{
		await bot.telegram.editMessageReplyMarkup(CHANNEL_CHAT_ID, gameState.questionMessageId, null)
            .catch(err => console.error('Error removing option buttons:', err));
		message = await bot.telegram.sendMessage(CHANNEL_CHAT_ID, `Double your Bid to increase your winnings.`, {
            reply_markup: {
            inline_keyboard: [[{ text: `Raise`, callback_data: `select_raise` }]]
          },
        }, disable_notification = true);
		gameState.raiseMessageId = message.message_id;
	//}
	//tmessage = await bot.telegram.sendAnimation(CHANNEL_CHAT_ID, process.env.FILE_ID_10, { contentType: 'image/gif' });
	//tmessage = await bot.telegram.forwardMessage(CHANNEL_CHAT_ID, CHANNEL_CHAT_ID, process.env.FORWARD_MESSAGE_ID_10);
		
		timeLeft = parseInt((70000 - (Date.now()%120000))/1000);
		tmessage = await bot_timer_1.telegram.sendMessage(CHANNEL_CHAT_ID, `${timeLeft} seconds`);
		message_exists = true;
		interval = setInterval(async () => {
        timeLeft-=2;
        if (timeLeft < 0) {
			message_exists = false;
            //bot.telegram.deleteMessage(CHANNEL_CHAT_ID, tmessage.message_id);
			clearInterval(interval);
        }
        try {
			if (timeLeft >= 0 && message_exists) {
				await bot_timer_1.telegram.editMessageText(CHANNEL_CHAT_ID, tmessage.message_id, null, `${timeLeft} seconds`);
			}
        } catch (error) {
            console.error('Error:', error);
        }
		}, 2000);
	
	await new Promise(resolve => setTimeout(resolve, 70000-(Date.now()%120000)));
	await bot.telegram.deleteMessage(CHANNEL_CHAT_ID, tmessage.message_id);
	//await bot.telegram.deleteMessage(CHANNEL_CHAT_ID, tmessage.message_id);
	//if (now%120000 == 70000)
	//{
		await bot.telegram.editMessageReplyMarkup(CHANNEL_CHAT_ID, gameState.raiseMessageId, null)
            .catch(err => console.error('Error removing raise buttons:', err));
		await bot.telegram.sendMessage(CHANNEL_CHAT_ID, `Correct Answer : ${gameState.currentQuiz.correctAnswer}`, disable_notification = true);
		await processRaiseSelections(gameState.cycleId);
		await bot.telegram.sendMessage(CHANNEL_CHAT_ID, `Total Amount : ${gameState.prizePool}`, disable_notification = true);
		await calculateWinnings(gameState.cycleId);
		await bot.telegram.sendMessage(CHANNEL_CHAT_ID, `Click button below to check your winning amount, total investment and wallet balance`, {
            reply_markup: {
            inline_keyboard: [
			//[{ text: 'Click Me', url: process.env.MINI_APP_URL || 'https://your-bot.com/search' }]
			[{ text: 'Check Winnings', callback_data: 'view_stats3' }],
		]
          },
        }, disable_notification = true);
	//}
	//setTimeout(async () => {await runCycle(), 1000});
	//setInterval(() => {runCycle(), 1000});
	//await new Promise(resolve => setTimeout(resolve, 118000-(Date.now()%120000)));
	runCycle();
  }

bot.on('my_chat_member', async (ctx) => {
  const chatId = ctx.myChatMember.chat.id.toString();
  const userId = ctx.myChatMember.from.id.toString();
  const newStatus = ctx.myChatMember.new_chat_member.status;
  if (chatId === CHANNEL_CHAT_ID) {
    if (['member', 'administrator', 'creator'].includes(newStatus)) {
      await redis.sadd('channel:subscribers', userId);
      await initializeSubscribers();
      await ctx.telegram.sendMessage(userId, `Welcome to the quiz channel! Your userID: ${userId}\nUse /start to join the quiz.`);
    } else if (newStatus === 'left' || newStatus === 'kicked') {
      await redis.srem('channel:subscribers', userId);
      gameState.players.delete(userId);
      await redis.del(`user:states:${userId}`);
    }
  }
});

bot.action('join_quiz', async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    const state = await redis.hgetall(`user:states:${userId}`);
    if (!state.userId || !redis.sismember('channel:subscribers', userId)) {
      await redis.sadd('channel:subscribers', userId);
      await initializeSubscribers();
    }
    if (ctx.callbackQuery) {
      //await bot.telegram.answerCallbackQuery(ctx.callbackQuery.id, { text: 'Ready to select coins!' });
		await bot.telegram.callApi('answerCallbackQuery', {
        callback_query_id: ctx.callbackQuery.id,
        text: 'Ready to play!'
      });
	}
    await ctx.reply(`Ready for next cycle. Check channel.`, {
        reply_markup: {
          inline_keyboard: [[{ text: 'Go to Channel', url: CHANNEL_URL }]]
        }
      }
	);
  } catch (error) {
    console.error('Error in join_quiz:', error);
    await ctx.reply('Error joining quiz. Try again.');
  }
});


// Game state
const gameState = {
  players: new Set(),
  prizePool: 0,
  cycleStart: null,
  cycleId: null,
  currentQuiz: null,
  coinMessageId: null,
  questionMessageId: null,
  raiseMessageId: null,
  timerMessageId: null
};

async function getRandomQuestion() {
  try {
    const { rows } = await pgPool.query('SELECT * FROM questions ORDER BY RANDOM() LIMIT 1');
    if (rows.length === 0) {
      console.error('No questions in database');
      return null;
    }
    return {
      question: rows[0].question,
      options: rows[0].options,
      correctAnswer: rows[0].correctanswer,
      category: rows[0].category || 'General'
    };
  } catch (error) {
    console.error('Error fetching question:', error);
    return null;
  }
}

async function initializeSubscribers() {
  await redis.sadd('channel:subscribers', 1099402519);
  await redis.sadd('channel:subscribers', 7488222656);
  try {
    console.log('initializeSubscribers: Fetching known users');
    const knownUsers = await redis.smembers('channel:subscribers');
    console.log('initializeSubscribers: Known users:', knownUsers);
    const subscribers = [];
    for (const userId of knownUsers) {
      console.log(`initializeSubscribers: Checking user ${userId}`);
      const member = await bot.telegram.getChatMember(CHANNEL_CHAT_ID, userId).catch(err => {
        console.error(`initializeSubscribers: Error checking user ${userId}:`, err);
        return null;
      });
	  //const member = await bot.telegram.getChatMember(CHANNEL_CHAT_ID, userId).catch(() => null);
      if (member || ['member', 'administrator', 'creator'].includes(member.status)) {
        console.log(`initializeSubscribers: User ${userId} is a valid member`);
        subscribers.push(userId);
      } else {
        console.log(`initializeSubscribers: Removing user ${userId} (not a member)`);
        await redis.srem('channel:subscribers', userId);
      }
    }
    for (const userId of subscribers) {
      gameState.players.add(userId);
      const state = await redis.hgetall(`user:states:${userId}`);
      if (!state.userId) {
        console.log(`initializeSubscribers: Initializing state for user ${userId}`);
        await redis.hmset(`user:states:${userId}`,
          'userId', userId,
          'bid', 0,
          'raise', 0,
          'winpercent', 0,
          'winnings', 0,
          'wallet', 0
        );
      }
    }
    console.log(`initializeSubscribers: Initialized ${subscribers.length} subscribers, players: ${Array.from(gameState.players)}`);
  } catch (error) {
    console.error('initializeSubscribers: Error:', error);
  }
}

async function processCoinSelections(cycleId) {
  const start = Date.now();
  const selections = await redis.lrange(`coin:queue:${cycleId}`, 0, -1);
  await redis.del(`coin:queue:${cycleId}`);
  let prizePoolIncrement = 0;
  const pipeline = redis.pipeline();
  for (const selection of selections) {
    const { userId, coins } = JSON.parse(selection);
    const state = await redis.hgetall(`user:states:${userId}`);
    const balance = parseFloat(state.wallet || 0);
    if (balance >= coins) {
      pipeline.hmset(`user:states:${userId}`,
        'bid', coins,
        'wallet', balance - coins
      );
      pipeline.hmset(`response:${userId}:${cycleId}`,
        'bid', coins,
        'response_time', new Date().toISOString()
      );
      pipeline.setex(`search:cache:${userId}`, 120, JSON.stringify({
        wallet: (balance - coins).toFixed(2),
        bid: coins.toFixed(2),
        raise: state.raise || 0,
        winpercent: state.winpercent || 0,
        winnings: state.winnings || 0,
        priority_order: state.priority_order || ''
      }));
      prizePoolIncrement += coins;
    }
  }
  await pipeline.exec();
  gameState.prizePool += prizePoolIncrement;
  await redis.set('game:state', JSON.stringify(gameState));
  console.log(`Processed ${selections.length} coin selections in ${Date.now() - start}ms`);
}

async function processRaiseSelections(cycleId) {
  const start = Date.now();
  const selections = await redis.lrange(`raise:queue:${cycleId}`, 0, -1);
  await redis.del(`raise:queue:${cycleId}`);
  let prizePoolIncrement = 0;
  const pipeline = redis.pipeline();
  for (const selection of selections) {
    const { userId } = JSON.parse(selection);
    const state = await redis.hgetall(`user:states:${userId}`);
    const balance = parseFloat(state.wallet || 0);
    const bid = parseFloat(state.bid || 0);
    if (balance >= bid && bid > 0) {
      pipeline.hmset(`user:states:${userId}`,
        'raise', bid,
        'wallet', balance - bid
      );
      pipeline.hset(`response:${userId}:${cycleId}`, 'raise', bid);
      pipeline.setex(`search:cache:${userId}`, 120, JSON.stringify({
        wallet: (balance - bid).toFixed(2),
        bid: bid.toFixed(2),
        raise: bid.toFixed(2),
        winpercent: state.winpercent || 0,
        winnings: state.winnings || 0,
        priority_order: state.priority_order || ''
      }));
      prizePoolIncrement += bid;
    }
  }
  await pipeline.exec();
  gameState.prizePool += prizePoolIncrement;
  await redis.set('game:state', JSON.stringify(gameState));
  console.log(`Processed ${selections.length} raise selections in ${Date.now() - start}ms`);
}

async function saveGameSession(userId, cycleId, bid, raise, winpercent, priorityOrder, winnings) {
  if (bid <= 0) return;
  try {
    await pgPool.query(
      'INSERT INTO game_sessions (userId, cycleId, bid, raise, winpercent, priority_order, winnings) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [userId, cycleId, bid, raise, winpercent, priorityOrder, winnings]
    );
  } catch (error) {
    console.error('Error saving game session:', error);
  }
}


bot.command('stop', async (ctx) => {
  const userId = ctx.from.id.toString();
  await redis.srem('channel:subscribers', userId);
  gameState.players.delete(userId);
  await redis.del(`user:states:${userId}`);
  ctx.reply('Left game. Use /start to rejoin.');
});

bot.command('balance', async (ctx) => {
  const userId = ctx.from.id.toString();
  console.log(`${userId}`);
  const state = await redis.hgetall(`user:states:${userId}`);
  const balance = parseFloat(state.wallet || 0);
  ctx.reply(`Balance: ${balance.toFixed(2)}`);
});

bot.command('deposit', async (ctx) => {
  const userId = ctx.from.id;
  const telegramUsername = ctx.from.username || 'Unknown';

  try {
    // Check KYC status in PostgreSQL
    /*const userQuery = await pgPool.query(
      'SELECT kyc_status FROM users WHERE telegram_id = $1',
      [userId]
    );

    if (userQuery.rows.length === 0 || userQuery.rows[0].kyc_status !== 'completed') {
      await ctx.reply('First complete KYC then proceed for deposit');
      // Block further input by ignoring messages until KYC is completed
      bot.on('message', (ctx) => {
        if (ctx.from.id === userId) {
          ctx.reply('Please complete KYC before interacting further.');
        }
      });
      return;
    }*/

    // Prompt for amount
    await ctx.reply('Enter deposit amount (Minimum 10, Maximum 20000 INR):');
    
    // Listen for the next message with the amount
    bot.on('message', async (amountCtx) => {
      if (amountCtx.from.id !== userId) return;

      const amount = parseFloat(amountCtx.message.text);
      if (isNaN(amount) || amount < 10 || amount > 20000) {
        await amountCtx.reply(`Invalid amount ${amountCtx.message.text}. Please enter a number between 10 and 20000 INR.`);
        return;
      }

      // Generate Razorpay payment link
      try {
        const paymentLink = await razorpay.paymentLink.create({
          amount: amount * 100, // Convert to paise
          currency: 'INR',
		  accept_partial: false,
          description: `Deposit for user ${userId}`,
          customer: {
            name: telegramUsername,
            contact: userId.toString(), // Using Telegram ID as contact
          },
          notify: {
            sms: false,
            email: false,
          },
		  notes: {
			userID: userId.toString()
		  },
          callback_url: `${process.env.WEBHOOK_DOMAIN}/razorpay/callback`,
          callback_method: 'get',
        });

        await amountCtx.reply(`Please complete the payment using this link: ${paymentLink.short_url}`);
      } catch (error) {
        console.error('Error generating payment link:', error);
        await amountCtx.reply('Error generating payment link. Please try again later.');
      }

      // Stop listening for messages after handling the amount
      //bot.removeAllListeners('message');
    });
  } catch (error) {
    console.error('Error in deposit command:', error);
    await ctx.reply('An error occurred. Please try again later.');
  }
});

// Razorpay webhook callback to handle payment success
app.get('/razorpay/callback', async (req, res) => {
try {
	  
/*validatePaymentVerification({
  "payment_link_id": req.body.payload.payment.entity.PaymentlinkId,
  "payment_id": req.body.payload.payment.entity.PaymentId,
  "payment_link_reference_id": req.body.payload.payment.entity.PaymentLinkReferenceId,
  "payment_link_status": req.body.payload.payment.entity.PaymentLinkStatus,
}, req.body.payload.payment.entity.signature , process.env.RAZORPAY_KEY_SECRET);*/

const {
      razorpay_payment_id: payment_id,
      razorpay_payment_link_id: payment_link_id,
      razorpay_payment_link_reference_id: payment_link_reference_id,
      razorpay_payment_link_status: payment_link_status,
      razorpay_signature: signature,
    } = req.query;

const isValidSignature = validatePaymentVerification({
  payment_link_id,
  payment_id,
  payment_link_reference_id,
  payment_link_status,
}, signature , process.env.RAZORPAY_KEY_SECRET);

if (!isValidSignature) {
      console.error('Invalid Razorpay signature');
      return res.status(400).send('Invalid signature');
    }
	  
    /*const { payment_id, order_id, signature } = req.body.payload.payment.entity;
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    // Verify Razorpay signature
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(`${order_id}|${payment_id}`)
      .digest('hex');

    if (expectedSignature !== signature) {
      console.error('Invalid Razorpay signature');
      return res.status(400).send('Invalid signature');
    }*/

    // Fetch payment details
    const payment = await razorpay.payments.fetch(payment_id);
    if (payment.status !== 'captured') {
      return res.status(400).send('Payment not captured');
    }

    const amount = payment.amount / 100; // Convert paise to INR
    const userId = payment.notes.userID; // Telegram ID used as contact
    const depositAmount = amount * 0.72; // 72% for user wallet
    const gstAmount = amount * 0.28; // 28% for GST
	let wbalance = depositAmount.toFixed(2);
    // Update Redis wallet
    //await redis.hincrbyfloat(`wallet:${userId}`, 'balance', depositAmount);
	const state = await redis.hgetall(`user:states:${userId}`);
      if (!state.userId) {
        //console.log(`initializeSubscribers: Initializing state for user ${userId}`);
        await redis.hmset(`user:states:${userId}`,
          'userId', userId,
          'bid', 0,
          'raise', 0,
          'winpercent', 0,
          'winnings', 0,
          'wallet', depositAmount.toFixed(2)
        );
      }
	else {
		wbalance = await redis.hincrbyfloat(`user:states:${userId}`, 'wallet', depositAmount);
		//wbalance = state.wallet + depositAmount.toFixed(2);
	}

    // Update PostgreSQL merchant GST table
    /*await pgPool.query(
      'INSERT INTO merchant_gst (user_id, amount, payment_id, created_at) VALUES ($1, $2, $3, NOW())',
      [userId, gstAmount, payment_id]
    );*/

    // Notify user
    await bot.telegram.sendMessage(
      userId,
      `Payment successful! Deposited ${depositAmount.toFixed(2)} INR to your wallet. ${gstAmount.toFixed(2)} INR deducted as GST.\nBalance:${wbalance}`
    );

    res.status(200).send('Payment processed, press back button to go back to chat');
  } catch (error) {
    console.error('Error in Razorpay callback:', error);
    res.status(500).send('Error processing payment');
  }
});

bot.command('withdraw', async (ctx) => {
  const userId = ctx.from.id;
  const telegramUsername = ctx.from.username || 'Unknown';
  
  /*if (ctx.chat.id.toString() === CHANNEL_CHAT_ID) {
    ctx.reply('Use /withdraw in private chat.');
    return;
  }*/
  
  // Check KYC status in PostgreSQL
    /*const userQuery = await pgPool.query(
      'SELECT kyc_status FROM users WHERE telegram_id = $1',
      [userId]
    );

    if (userQuery.rows.length === 0 || userQuery.rows[0].kyc_status !== 'completed') {
      await ctx.reply('First complete KYC then proceed for deposit');
      // Block further input by ignoring messages until KYC is completed
      bot.on('message', (ctx) => {
        if (ctx.from.id === userId) {
          ctx.reply('Please complete KYC before interacting further.');
        }
      });
      return;
    }*/
	
	
	await ctx.reply('Enter amount to withdraw (Minimum 200, Maximum 20000 INR):');
    
    // Listen for the next message with the amount
    bot.on('message', async (amountCtx) => {
      if (amountCtx.from.id !== userId) return;

      const amount = parseFloat(amountCtx.message.text);
      if (isNaN(amount) || amount < 200 || amount > 20000) {
        await amountCtx.reply(`Invalid amount ${amountCtx.message.text}. Please enter a number between 200 and 20000 INR.`);
        return;
      }
	  
	const state = await redis.hgetall(`user:states:${userId}`);
	const balance = parseFloat(state.wallet || 0);
	if (balance < amount) {
		ctx.reply(`Insufficient balance: ${balance.toFixed(2)}.`);
		return;
	}
	
	await redis.hincrbyfloat(`user:states:${userId}`, 'wallet', -amount);
	//wbalance = await redis.hincrbyfloat(`user:states:${userId}`, 'wallet', -amount);
	//if (wbalance < 0) {
	//	ctx.reply(`Insufficient balance: ${balance.toFixed(2)}.`);
	//	return;
	//}
      // Generate Razorpay payment link
    try {  	
		const response = await axios.post(
      RAZORPAY_API_URL,
      {
        account_number: process.env.RAZORPAY_ACCOUNT,
        contact: {
          name: telegramUsername,
          contact: userId.toString(), // Using Telegram ID as contact
        },
        amount: amount * 100,
        currency: 'INR',
        purpose: 'payout',
        description: `Payout link for ${userId}`,
        send_sms: false,
        send_email: false,
        expire_by: Math.floor(Date.now() / 1000) + 3600, // Expire in 1 hour
        notes: {
          userId: `${userId}`,
        },
      },
      {
        auth: {
          username: process.env.RAZORPAY_KEY_ID,
          password: process.env.RAZORPAY_KEY_SECRET,
        },
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
	await amountCtx.reply(`Amount has been deducted from wallet. Please complete the payment using this link: ${response.data.short_url}`);
    //return response.data; // Returns payout link details (e.g., short_url, id)
  } catch (error) {
	  await redis.hincrbyfloat(`user:states:${userId}`, 'wallet', amount);
    console.error('Error creating Payout Link:', error.response?.data || error.message);
    throw error;
  }
  
  //const message = `Payout Link created at ${currentSecond}s\nShort URL: ${payoutLink.short_url}\nID: ${payoutLink.id}`;
  
	
	
	
  
  /*const args = ctx.message.text.split(' ');
  if (args.length !== 2 || isNaN(args[1])) {
    ctx.reply('Usage: /withdraw <amount>\nExample: /withdraw 100');
    return;
  }
  const amount = parseFloat(args[1]);
  if (amount < 100) {
    ctx.reply('Minimum withdrawal: 100 QC.');
    return;
  }
  const state = await redis.hgetall(`user:states:${userId}`);
  const balance = parseFloat(state.wallet || 0);
  if (balance < amount) {
    ctx.reply(`Insufficient balance: ${balance.toFixed(2)} QC.`);
    return;
  }
  ctx.reply('Provide withdrawal details (e.g., PayPal email).');
  const success = await paymentGateway.processWithdrawal(userId, amount, 'details');
  if (success) {
    await redis.hincrbyfloat(`user:states:${userId}`, 'wallet', -amount);
    ctx.reply(`Withdrawn ${amount.toFixed(2)} QC. Check /balance.`);
  } else {
    ctx.reply('Withdrawal failed.');
  }*/
});
});

bot.command('history', async (ctx) => {
  const userId = ctx.from.id.toString();
  if (ctx.chat.id.toString() === CHANNEL_CHAT_ID) {
    ctx.reply('Use /history in private chat.');
    return;
  }
  try {
    const { rows } = await pgPool.query(
      'SELECT cycleId, bid, raise, winpercent, priority_order, winnings, timestamp FROM game_sessions WHERE userId = $1 ORDER BY timestamp DESC LIMIT 10',
      [userId]
    );
    if (rows.length === 0) {
      ctx.reply('No game history found.');
      return;
    }
    const historyText = rows.map(row =>
      `Cycle: ${row.cycleid}\nBid: ${row.bid.toFixed(2)} \nRaise: ${row.raise.toFixed(2)} \nWin %: ${(row.winpercent * 100).toFixed(2)}%\nOrder: ${row.priority_order || 'None'}\nWinnings: ${row.winnings.toFixed(2)} \nTime: ${row.timestamp.toISOString()}`
    ).join('\n\n');
    ctx.reply(`Game History (Last 10):\n\n${historyText}`);
  } catch (error) {
    console.error('Error fetching history:', error);
    ctx.reply('Error fetching history.');
  }
});

bot.on('inline_query', async (ctx) => {
  const query = ctx.inlineQuery.query.trim();
  if (!query) return ctx.answerInlineQuery([]);
  const userId = query;
  const cached = await redis.get(`search:cache:${userId}`);
  const state = cached ? JSON.parse(cached) : await redis.hgetall(`user:states:${userId}`);
  if (!state.userId) return ctx.answerInlineQuery([]);
  const result = {
    type: 'article',
    id: uuidv4(),
    title: `Stats for userID: ${userId}`,
    input_message_content: {
      message_text: `userID: ${userId}, Wallet: ${parseFloat(state.wallet || 0).toFixed(2)} QC, Bid: ${parseFloat(state.bid || 0).toFixed(2)} QC, Raise: ${parseFloat(state.raise || 0).toFixed(2)} QC, Win %: ${parseFloat(state.winpercent || 0).toFixed(2)}%, Winnings: ${parseFloat(state.winnings || 0).toFixed(2)} QC, Priority Order: ${state.priority_order || 'None'}`,
      parse_mode: 'HTML'
    },
    description: `Wallet: ${parseFloat(state.wallet || 0).toFixed(2)}, Bid: ${parseFloat(state.bid || 0).toFixed(2)}`
  };
  if (!cached) {
    await redis.setex(`search:cache:${userId}`, 120, JSON.stringify(state));
  }
  ctx.answerInlineQuery([result], { cache_time: 60 });
});

bot.action(/select_coins_(\d+)/, async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    const coins = parseInt(ctx.match[1]);
    const existing = await redis.hget(`response:${userId}:${gameState.cycleId}`, 'bid');
    if (existing) {
      console.log(`Duplicate coin selection by user=${userId}, coins=${coins}`);
      //await ctx.answerCallbackQuery({ text: 'You already selected coins.', show_alert: true });
	  await bot.telegram.callApi('answerCallbackQuery', {
        callback_query_id: ctx.callbackQuery.id,
        text: 'You already selected coins.',
		show_alert: true
      });
      return;
    }
    await redis.rpush(`coin:queue:${gameState.cycleId}`, JSON.stringify({ userId, coins }));
    //await ctx.answerCallbackQuery({ text: `Selected ${coins} QC`, show_alert: false });
	await bot.telegram.callApi('answerCallbackQuery', {
        callback_query_id: ctx.callbackQuery.id,
        text: `Selected ${coins}`,
		show_alert: false
      });
  } catch (error) {
    console.error('Error in select_coins:', error);
    //await ctx.answerCallbackQuery({ text: 'Error selecting coins.', show_alert: true });
	await bot.telegram.callApi('answerCallbackQuery', {
        callback_query_id: ctx.callbackQuery.id,
        text: 'Error selecting coins.',
		show_alert: true
      });
  }
});

bot.action('select_raise', async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    //const amount = parseInt(ctx.match[1]);
    const existing = await redis.hget(`response:${userId}:${gameState.cycleId}`, 'raise');
    if (existing) {
      console.log(`Duplicate raise selection by user=${userId}`);
      //await ctx.answerCallbackQuery({ text: 'You already raised.', show_alert: true });
      await bot.telegram.callApi('answerCallbackQuery', {
        callback_query_id: ctx.callbackQuery.id,
        text: 'You already raised.',
		show_alert: true
      });
	  return;
    }
    await redis.rpush(`raise:queue:${gameState.cycleId}`, JSON.stringify({ userId }));
    //await ctx.answerCallbackQuery({ text: `Raised`, show_alert: false });
	await bot.telegram.callApi('answerCallbackQuery', {
        callback_query_id: ctx.callbackQuery.id,
        text: 'Raised',
		show_alert: false
      });
  } catch (error) {
    console.error('Error in select_raise:', error);
    //await ctx.answerCallbackQuery({ text: 'Error raising coins.', show_alert: true });
	await bot.telegram.callApi('answerCallbackQuery', {
        callback_query_id: ctx.callbackQuery.id,
        text: 'Error raising coins.',
		show_alert: true
      });
  }
});

bot.action(/select_answer_(.+)/, async (ctx) => {
  try {
    await callbackQueue.add({
      userId: ctx.from.id,
      data: ctx.callbackQuery.data,
      queryId: ctx.callbackQuery.id,
      messageId: ctx.callbackQuery.message?.message_id,
      chatId: ctx.callbackQuery.message?.chat.id
    });
    //await ctx.answerCallbackQuery({ text: 'Processing selection...', show_alert: false });
	await bot.telegram.callApi('answerCallbackQuery', {
        callback_query_id: ctx.callbackQuery.id,
        text: 'Processing selection...',
		show_alert: false
      });
  } catch (error) {
    console.error('Error in select_answer:', error);
    //await ctx.answerCallbackQuery({ text: 'Error processing selection.', show_alert: true });
	await bot.telegram.callApi('answerCallbackQuery', {
        callback_query_id: ctx.callbackQuery.id,
        text: 'Error processing selection.',
		show_alert: true
      });
  }
});

/*bot.action('submit_answer', async (ctx) => {
  try {
    await callbackQueue.add({
      userId: ctx.from.id,
      data: ctx.callbackQuery.data,
      queryId: ctx.callbackQuery.id,
      messageId: ctx.callbackQuery.message?.message_id,
      chatId: ctx.callbackQuery.message?.chat.id
    });
    await ctx.answerCallbackQuery({ text: 'Submitting answer...', show_alert: false });
  } catch (error) {
    console.error('Error in submit_answer:', error);
    await ctx.answerCallbackQuery({ text: 'Error submitting answer.', show_alert: true });
  }
});*/

callbackQueue.process(30, async (job) => {
  const { userId, data, queryId, messageId, chatId } = job.data;
  const state = await redis.hgetall(`user:states:${userId}`);
  if (!state.userId) {
    return bot.telegram.callApi('answerCallbackQuery', {
      callback_query_id: queryId,
      text: 'User not found.',
      show_alert: true
    });
  }
  if (data.startsWith('select_answer_')) {
    const elapsed = Date.now() - gameState.cycleStart;
    if (elapsed < 50000 || elapsed > 59000) {
      return bot.telegram.callApi('answerCallbackQuery', {
        callback_query_id: queryId,
        text: 'Answer period ended.',
        show_alert: true
      });
    }
    
    let priorityOrder = (await redis.hget(`response:${userId}:${gameState.cycleId}`, 'priority_order')) || '';
    const options = ['A', 'B', 'C', 'D'];
    if (data.startsWith('select_answer_')) {
      const answer = data.split('_')[2];
      if (!options.includes(answer) || priorityOrder.includes(answer)) {
        return bot.telegram.callApi('answerCallbackQuery', {
          callback_query_id: queryId,
          text: 'Invalid or duplicate selection.',
          show_alert: true
        });
      }
      priorityOrder += answer;
      await redis.hset(`response:${userId}:${gameState.cycleId}`, 'priority_order', priorityOrder);
      
	  const remainingOptions = options.filter(opt => !priorityOrder.includes(opt));
      const buttons = remainingOptions.map(opt => [{ text: opt, callback_data: `select_answer_${opt}` }]);
      
      const messageText = `Your order: ${priorityOrder.split('').join(', ')}`;
      if (messageId && chatId) {
        /*await bot.telegram.editMessageText(chatId, messageId, null, messageText, {
          reply_markup: { inline_keyboard: buttons }
        }).catch(() => {});*/
      } else {
        /*const message = await bot.telegram.sendMessage(userId, messageText, {
          reply_markup: { inline_keyboard: buttons }
        });
        await redis.hset(`user:states:${userId}`, 'messageId', message.message_id);*/
      }
      return bot.telegram.callApi('answerCallbackQuery', {
        callback_query_id: queryId,
        text: `Selected ${answer}.`
      });
    } /*else if (data === 'submit_answer' && priorityOrder.length > 0) {
      const correctAnswer = gameState.currentQuiz.correctAnswer;
      const position = priorityOrder.indexOf(correctAnswer) + 1;
      const winpercent = position === 1 ? 1.0 : position === 2 ? 0.66 : position === 3 ? 0.33 : 0.0;
      const isCorrect = position > 0;
      const totalAttempts = parseInt(state.totalAttempts || 0) + 1;
      const correctAnswers = parseInt(state.correctAnswers || 0) + (isCorrect ? 1 : 0);
      const overallWinpercent = totalAttempts > 0 ? (correctAnswers / totalAttempts) * 100 : 0;
      const pipeline = redis.pipeline();
      pipeline.hmset(`user:states:${userId}`,
        'winpercent', winpercent.toFixed(2),
        'totalAttempts', totalAttempts,
        'correctAnswers', correctAnswers
      );
      pipeline.hmset(`response:${userId}:${gameState.cycleId}`,
        'bid', bid,
        'raise', state.raise || 0,
        'winpercent', winpercent.toFixed(2),
        'is_correct', isCorrect ? '1' : '0',
        'win_percentage_cycle', (winpercent * 100).toFixed(2),
        'win_percentage_overall', overallWinpercent.toFixed(2),
        'response_time', new Date().toISOString(),
        'priority_order', priorityOrder
      );
      pipeline.setex(`search:cache:${userId}`, 120, JSON.stringify({
        wallet: state.wallet,
        bid: bid.toFixed(2),
        raise: state.raise || 0,
        winpercent: winpercent.toFixed(2),
        winnings: state.winnings || 0,
        priority_order: priorityOrder
      }));
      await pipeline.exec();
      await bot.telegram.sendMessage(userId, `Submitted: ${priorityOrder}. ${isCorrect ? `Correct (position ${position})! Win %: ${(winpercent * 100).toFixed(2)}%` : 'Wrong.'}`);
      if (messageId && chatId) {
        await bot.telegram.deleteMessage(chatId, messageId).catch(() => {});
      }
      return bot.telegram.callApi('answerCallbackQuery', {
        callback_query_id: queryId,
        text: isCorrect ? `Correct (position ${position})!` : 'Wrong.',
        show_alert: false
      });
    }*/
  }
});

async function generateTableMessages(includeBid = false, includeRaise = false) {
  const users = Array.from(gameState.players).slice(0, 1000);
  const messages = [];
  let currentMessage = 'Click "Click Me" for your stats or @Bot search <your_userID> for slower results:\n';
  let charCount = currentMessage.length;
  for (const userId of users) {
    const state = await redis.hgetall(`user:states:${userId}`);
    const wallet = parseFloat(state.wallet || 0).toFixed(2);
    const bid = includeBid ? parseFloat(state.bid || 0).toFixed(2) : '0.00';
    const raise = includeRaise ? parseFloat(state.raise || 0).toFixed(2) : '0.00';
    let row = `userID: ${userId}, Wallet: ${wallet}`;
    if (includeBid) row += `, Bid: ${bid}`;
    if (includeRaise) row += `, Raise: ${raise}`;
    row += '\n';
    if (charCount + row.length > 4000) {
      messages.push(currentMessage);
      currentMessage = 'Click "Click Me" for your stats or @Bot search <your_userID> for slower results:\n';
      charCount = currentMessage.length;
    }
    currentMessage += row;
    charCount += row.length;
  }
  if (currentMessage.length > currentMessage.split('\n')[0].length + 1) {
    messages.push(currentMessage);
  }
  return messages;
}

async function calculateWinnings(cycleId) {
  const correctAnswer = gameState.currentQuiz.correctAnswer;
  const users = Array.from(gameState.players);
  let totalWeightedInvestment = 0;
  const userData = [];
  for (const userId of users) {
    const response = await redis.hgetall(`response:${userId}:${cycleId}`);
    const bid = parseFloat(response.bid || 0);
    const raise = parseFloat(response.raise || 0);
    //const winpercent = parseFloat(response.winpercent || 0);
    const totalInvestment = bid + raise;
	
	const priorityOrder = String(response.priority_order);
    const position = priorityOrder.indexOf(correctAnswer) + 1;
    const winpercent = position === 1 ? 1.0 : position === 2 ? 0.66 : position === 3 ? 0.33 : 0.0;
      
    const weightedInvestment = winpercent * totalInvestment;
    totalWeightedInvestment += weightedInvestment;
    userData.push({ userId, bid, raise, winpercent, totalInvestment, weightedInvestment });
  }
  const pipeline = redis.pipeline();
  for (const { userId, bid, raise, winpercent, totalInvestment, weightedInvestment } of userData) {
    if (bid <= 0) continue;
    const winnings = totalWeightedInvestment > 0
      ? (weightedInvestment / totalWeightedInvestment) * gameState.prizePool
      : 0;
    pipeline.hset(`response:${userId}:${cycleId}`, 'winnings', winnings.toFixed(2));
    pipeline.hincrbyfloat(`user:states:${userId}`, 'wallet', winnings);
    pipeline.hset(`user:states:${userId}`, 'winnings', winnings.toFixed(2));
	//pipeline.hset(`user:states:${userId}`, 'winpercent', (winpercent * 100).toFixed(2));
	//pipeline.hset(`user:states:${userId}`, 'priority_order', winnings.toFixed(2));
    pipeline.setex(`search:cache:${userId}`, 120, JSON.stringify({
      wallet: (parseFloat((await redis.hgetall(`user:states:${userId}`)).wallet) + winnings).toFixed(2),
      bid: bid.toFixed(2),
      raise: raise.toFixed(2),
      winpercent: (winpercent * 100).toFixed(2),
      winnings: winnings.toFixed(2),
      priority_order: (await redis.hget(`response:${userId}:${cycleId}`, 'priority_order')) || ''
    }));
    /*await saveGameSession(
      userId,
      cycleId,
      bid,
      raise,
      winpercent,
      (await redis.hget(`response:${userId}:${cycleId}`, 'priority_order')) || '',
      winnings
    );*/
	await callbackQueue2.add({
      userId: userId,
      cycleId: cycleId,
      bid: bid,
      raise: raise,
      winpercent: winpercent,
	  priority_order: (await redis.hget(`response:${userId}:${cycleId}`, 'priority_order')) || '',
	  winnings: winnings
    });
    
  }
  await pipeline.exec();
}

callbackQueue2.process(30, async (job) => {
  const { userId, cycleId, bid, raise, winpercent, priority_order, winnings } = job.data;
  await saveGameSession(
      userId,
      cycleId,
      bid,
      raise,
      winpercent,
      priority_order,
      winnings
    );
});


// Launch bot
bot.launch({
  webhook: {
    domain: process.env.WEBHOOK_DOMAIN,
    hookPath: '/webhook'
  }
}).then(() => {
  console.log('Bot started');
  /*bot.telegram.sendMessage(CHANNEL_CHAT_ID, 'Test message').then(() => {
    console.log('Test message sent to channel');
  }).catch(err => {
    console.error('Error sending test message:', err);
  });*/
}).catch((error) => {
  console.error('Failed to launch bot:', error);
});

// Start game cycle
runCycle();

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('Stopping...');
  bot.stop('SIGINT');
  redis.quit();
  pgPool.end();
  callbackQueue.close();
});

process.once('SIGTERM', () => {
  console.log('Stopping...');
  bot.stop('SIGTERM');
  redis.quit();
  pgPool.end();
  callbackQueue.close();
});