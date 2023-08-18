/**
  TWITCH PLAY TRACKMANIA
  @author : Nykho
  @helper : ex_ode
  @helper : Eliewan

  Creates a bot listening to a twitch chat, controlling the Trackmania Car.
  This app must be running on the same pc where the game is installed

  Git related : https://github.com/Nykh0/twitch-play-trackmania
*/
import { config as configDotEnv } from 'dotenv';
import tmi from 'tmi.js';
import robot from 'robotjs';
import axios from 'axios';
import open from 'open';
import express from 'express';

/**
 * Populate env variables without passing them in command line
 */
configDotEnv();

/*
  To allow the bot to create polls, we need to get authorization from twitch. As such, we get it using the Authorization code grant flow
  More info on the process here : https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#authorization-code-grant-flow
*/

// We open the website to login
open("https://id.twitch.tv/oauth2/authorize" +
	"?response_type=code" +
	`&client_id=${process.env.TWITCH_CLIENT_ID}` +
	`&redirect_uri=${process.env.TWITCH_REDIRECT_URL}` +
	"&scope=channel:read:polls channel:manage:polls");

// Creating a small web server to handle the redirect
const app = express();
const port = 3000;

// Endpoint GET /auth/twitch/callback
app.get('/auth/twitch/callback', (req, res) => {
	// Getting our access token
	axios.post("https://id.twitch.tv/oauth2/token", {
		client_id: process.env.TWITCH_CLIENT_ID,
		client_secret: process.env.TWITCH_CLIENT_SECRET,
		code: req.query.code,
		redirect_uri: "http://localhost:3000/auth/twitch/callback",
		grant_type: "authorization_code"
	}).then(tokenObject => {
		// Setting axios default headers so we don't have to worry about them anymore
		axios.defaults.headers.common["Authorization"] = `Bearer ${tokenObject.data.access_token}`;
		axios.defaults.headers.common["Client-Id"] = process.env.TWITCH_CLIENT_ID;
		axios.defaults.headers.common["Content-Type"] = "application/json";
		// Creating the job to validate our token hourly
		setInterval(() => validateAccessToken(), 3600000); // 3600000 ms = 1 hour
		// Getting the numerical ID of the user
		axios.get("https://api.twitch.tv/helix/users", { params: { login: process.env.TWITCH_CHANNEL_NAME } }).then(response => {
			twitchUserId = response.data.data[0].id;
			// We get the number of viewer to adapt the threshold of the future restart votes.
			updateViewerCount();
			// After that, we're starting the jobs to update the viewer count every minute and to initiliaze the vote handler.
			setInterval(() => updateViewerCount(), 60000);
			setInterval(() => handleRestarts(), 5000);
		});
	})
		.catch(error => {
			throw new Error(error); // We prefer to throw away the error, as all the above information is imperative.
		});
	res.send("You can close this window !");
});

// App listener needed for express to work
app.listen(port, () => {
	console.log(`App listening on port ${port}. If the port is different than 3000, please change the redirect url in the .env file`);
});

// VARIABLES
const intervalIds = [];
let twitchUserId = null; //Twitch numerical user ID
let canAskForVote = true; //Bool for blocking not needed !r or !rm request
let minimumVoteRequiredCheckpoint = 50000; // Minimum of votes required to trigger the poll to respawn at a checkpoint
let minimumVoteRequiredMap = 50000; // Minimum of votes required to trigger the poll to restart the map

// Our directions
const DIRECTIONS = ['FORWARD', 'BACK', 'LEFT', 'RIGHT'];

// Creating the TMI client to connect the bot to the chat. Requires informations from the .env
const client = new tmi.Client({
	options: { debug: true },
	connection: {
		secure: true,
		reconnect: true
	},
	identity: {
		username: process.env.TWITCH_CHANNEL_NAME,
		password: process.env.TWITCH_OAUTH_TOKEN
	},
	channels: [process.env.TWITCH_CHANNEL_NAME]
});

// Our data for the controls and restart votes.
const VALUES_DATA = {
	FORWARD: { value: 0, intervalId: null },
	BACK: { value: 0, intervalId: null },
	LEFT: { value: 0, intervalId: null },
	RIGHT: { value: 0, intervalId: null },
	RESTART: { valueCheckpoint: [], valueMap: [], threshold: 10 }
};

/**
 * Validate the Twitch token
 */
function validateAccessToken() {
	axios.get("https://id.twitch.tv/oauth2/validate").then(response => {
		console.log(response.data);
	});
}

/**
 * Gets the viewer count and adapts the voting thresholds
 */
function updateViewerCount() {
	axios.get("https://api.twitch.tv/helix/streams", {
		params: {
			user_id: twitchUserId
		}
	}).then((reponse) => {
		if (reponse.data.data.length == 0) {
			console.log("The channel seems to be offline")
		} else {
			minimumVoteRequiredCheckpoint = reponse.data.data[0].viewer_count > 16 ? Math.ceil(reponse.data.data[0].viewer_count * 0.05) : 3;
			minimumVoteRequiredMap = reponse.data.data[0].viewer_count > 10 ? Math.ceil(reponse.data.data[0].viewer_count * 0.15) : 5;
		}
	});
}

/**
 * Restart/Respawn handler
 *
 * Every 5 seconds, check the number of !r or !rm.
 * If these number are superior to the theshold, triggers a poll.
 * If the poll succeed, the car is respawned/the map is restarted
 * If not, nothing happens
 *
 * In each case, a timeout of 1 minute comes up once the vote is started or when a moderator respawn/restart
 */
function handleRestarts() {
	// Adapting treshold depending on how many people are watching
	if (minimumVoteRequiredCheckpoint <= VALUES_DATA.RESTART.valueCheckpoint.length) {
		resetRestartValuesAndTimeOut(60000, false);
		// Creating poll
		axios.post("https://api.twitch.tv/helix/polls", {
			broadcaster_id: twitchUserId,
			title: "Restart at Checkpoint ? (20 seconds)",
			choices: [{ title: "Yes" }, { title: "No" }],
			duration: 20
		}).then(response => {
			setTimeout(() => {
				//Checking result
				axios.patch("https://api.twitch.tv/helix/polls", {
					broadcaster_id: twitchUserId,
					id: response.data.data[0].id,
					status: "TERMINATED"
				}).then(responsePatch => {
					if (responsePatch.data.data[0].choices[0].votes > responsePatch.data.data[0].choices[1].votes) {
						robot.keyTap('pagedown');
					}
				})
			}, 18000);
		});
	} else if (minimumVoteRequiredMap <= VALUES_DATA.RESTART.valueMap.length) {
		resetRestartValuesAndTimeOut(60000, false);
		// Creating poll
		axios.post("https://api.twitch.tv/helix/polls", {
			broadcaster_id: twitchUserId,
			title: "Restart the entire map ? (30 seconds)",
			choices: [{ title: "Yes" }, { title: "No" }],
			duration: 30
		}).then(response => {
			setTimeout(() => {
				// Checking result
				axios.patch("https://api.twitch.tv/helix/polls", {
					broadcaster_id: twitchUserId,
					id: response.data.data[0].id,
					status: "TERMINATED"
				}).then(responsePatch => {
					if (responsePatch.data.data[0].choices[0].votes > responsePatch.data.data[0].choices[1].votes) {
						robot.keyTap('delete');
					}
				})
			}, 30000);
		});
	}
}

/**
 * Clear values and intervals at each reset to prevent some bugs
 */
function clearIntervalsAndValues() {
	intervalIds.forEach(d => {
		clearInterval(d);
	});
	intervalIds.length = 0;
	DIRECTIONS.forEach(d => {
	  //clearInterval(VALUES_DATA[d].intervalId);
	  VALUES_DATA[d].intervalId = null;
	  VALUES_DATA[d].value = 0;
	});
}

/**
 * Reset votes and block new tentatives for <delayTimeOutMs> milliseconds
 * @param {number} delayTimeOutMs 
 */
function resetRestartValuesAndTimeOut(delayTimeOutMs, isAdmin) {
	clearIntervalsAndValues();
	VALUES_DATA.RESTART.valueCheckpoint.length = 0;
	VALUES_DATA.RESTART.valueMap.length = 0;
	if (!isAdmin){
		canAskForVote = false;
		client.say("#" + process.env.TWITCH_CHANNEL_NAME, "/me You cannot do the command !r or !rm for 1 minute.");
		setTimeout(() => {
			canAskForVote = true;
			client.say("#" + process.env.TWITCH_CHANNEL_NAME, "/me The vote functionnality is now enabled");
		}, delayTimeOutMs);
	} else {
		client.say("#" + process.env.TWITCH_CHANNEL_NAME, "/me A moderator reseted ! Vote counts are back to 0 !");
	}
}

/**
 * Handle if the key set in parameters is to be pressed or not
 * 
 * @param {string} keyName Name of the key. Exemple : FORWARD
 * @param {string} key Id of the key to be pressed following robotjs documentation
 */
function handleKeyPress(keyName, key) {
	clearInterval(VALUES_DATA[keyName].intervalId);
	VALUES_DATA[keyName].value--;
	if (VALUES_DATA[keyName].value < 0) VALUES_DATA[keyName].value = 0
	if (VALUES_DATA[keyName].value > 0) {
		let newTick = process.env[keyName + "_TICK"] / VALUES_DATA[keyName].value;
		VALUES_DATA[keyName].intervalId = setInterval(() => handleKeyPress(keyName, key), newTick);
	} else {
		robot.keyToggle(key, 'up', 'none');
		clearInterval(VALUES_DATA[keyName].intervalId);
	}
}

// TMI connecting to Twitch
client.connect();

// For each messages
client.on('message', (channel, tags, message, self) => {
	// Ignore echoed messages.
	if (self) return;

	if (!message.startsWith("!")) {
		// Forward count
		if (message.toLowerCase().includes('++') || message.toLowerCase().includes('fw')) {
			if (VALUES_DATA.FORWARD.value === 0) {
				robot.keyToggle('up', 'down', 'none');
				VALUES_DATA.FORWARD.intervalId = setInterval(() => handleKeyPress("FORWARD", "up"), process.env.FORWARD_TICK);
				intervalIds.push(VALUES_DATA.FORWARD.intervalId);
			}
			// Clearing faster the opposite direction. If not, adding +1 to the current direction
			if (VALUES_DATA.BACK.value > 0) VALUES_DATA.BACK.value--;
			else VALUES_DATA.FORWARD.value++;
		}
		// Backward count
		else if (message.toLowerCase().includes('--') || message.toLowerCase().includes('bw')) {
			if (VALUES_DATA.BACK.value == 0) {
				robot.keyToggle('down', 'down', 'none');
				VALUES_DATA.BACK.intervalId = setInterval(() => handleKeyPress("BACK", "down"), process.env.BACK_TICK);
				intervalIds.push(VALUES_DATA.BACK.intervalId);
			}
			// Clearing faster the opposite direction. If not, adding +1 to the current direction
			if (VALUES_DATA.FORWARD.value > 0) VALUES_DATA.FORWARD.value--;
			else VALUES_DATA.BACK.value++;
		}
		// Left count
		if (message.toLowerCase().includes('<<') || message.toLowerCase().includes('left')) {
			if (VALUES_DATA.LEFT.value == 0) {
				robot.keyToggle('left', 'down', 'none');
				VALUES_DATA.LEFT.intervalId = setInterval(() => handleKeyPress("LEFT", "left"), process.env.LEFT_TICK);
				intervalIds.push(VALUES_DATA.LEFT.intervalId);
			}
			// Clearing faster the opposite direction. If not, adding +1 to the current direction
			if (VALUES_DATA.RIGHT.value > 0) VALUES_DATA.RIGHT.value--;
			else VALUES_DATA.LEFT.value++;
		}
		// Right count
		else if (message.toLowerCase().includes('>>') || message.toLowerCase().includes('right')) {
			if (VALUES_DATA.RIGHT.value == 0) {
				robot.keyToggle('right', 'down', 'none');
				VALUES_DATA.RIGHT.intervalId = setInterval(() => handleKeyPress("RIGHT", "right"), process.env.RIGHT_TICK);
				intervalIds.push(VALUES_DATA.RIGHT.intervalId);
			}
			// Clearing faster the opposite direction. If not, adding +1 to the current direction
			if (VALUES_DATA.LEFT.value > 0) VALUES_DATA.LEFT.value--;
			else VALUES_DATA.RIGHT.value++;
		}
	} else {
		// Check if the message comes from a mod or the broadcaster
		const isAdmin = tags.mod || (tags.username.toLowerCase() === process.env.TWITCH_CHANNEL_NAME.toLowerCase());
		// Informing the user that he can't activate the vote yet
		if (!canAskForVote && !isAdmin && (message.toLowerCase() === "!rm" || message.toLowerCase() === "!r")) {
			client.say(channel, `${tags.username}, you'll be able to do this command once the timeout is over.`);
		}
		// Respawn at checkpoint handler
		else if (message.toLowerCase() === "!r") {
			//If the messages comes from an admin, automatically restart at checkpoint and activate the timeout
			if (isAdmin) {
				robot.keyTap('pagedown');
				resetRestartValuesAndTimeOut(60000, true);
			}
			// Check if the user already did the command. If not, adds his username to the array
			 else if (!VALUES_DATA.RESTART.valueCheckpoint.includes(tags.username.toLowerCase())) {
				VALUES_DATA.RESTART.valueCheckpoint.push(tags.username.toLowerCase());
				let modeVotesRequired = minimumVoteRequiredCheckpoint - VALUES_DATA.RESTART.valueCheckpoint.length;
				// Inform other users of how many votes remains.
				if (modeVotesRequired > 0)
					client.say(channel, `${modeVotesRequired} more votes are required to start the poll to respawn at the last checkpoint !`);
			}
		}
		// Map restart handler
		else if (message.toLowerCase() === "!rm") {
			// If the messages comes from an admin, automatically restart the map and activate the timeout
			if (isAdmin) {
				robot.keyTap('delete');
				resetRestartValuesAndTimeOut(60000, true);
			}
			// Check if the user already did the command. If not, adds his username to the array
			else if (!VALUES_DATA.RESTART.valueMap.includes(tags.username.toLowerCase())) {
				VALUES_DATA.RESTART.valueMap.push(tags.username.toLowerCase());
				let modeVotesRequired = minimumVoteRequiredMap - VALUES_DATA.RESTART.valueMap.length;
				// Inform other users of how many votes remains.
				if (modeVotesRequired > 0)
					client.say(channel, `${modeVotesRequired} more votes are required to start the poll to restart the map !`);
			}
		}
	}
});