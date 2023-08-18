# twitch-play-trackmania
Own version of a bot to play Trackmania with chat, mostly to train myself and also to enhance current functionnalities.

While it was fun to create, this is not an optimal way to handle a twitch play, as NodeJS is not adapted for this. Still, it was a nice experience using NodeJS for this challenge.

The bot uses the [Robot.JS](https://robotjs.io/) library.

I don't plan on updating further the bot.

# Prerequisie
- NodeJS 18.70.0
- Choco (installed with the NodeJS installer)
- Visual Studio 2013
- Python (v2.7.3 recommended)

# Setup
Clone the repository then execute ```npm install``` or if you have pnpm ```pnpm install```

# Usage
Open the ```.env.example``` ,replace values as asked within and change the name of the file in ```.env```

Once it's done, execute ```npm start``` or if you have pnpm ```pnpm install```

If this is the first time you're booting the app, you'll be prompted to connect to twitch. This step is necessary as we need an authentication token for votes. You won't need to do it anymore after that while the token is valid.

Once you have given permissions, you're ready to go ! Just focus the Trackmania Window and let's the mayhem begin !

# Thanks
Thanks to ex_ode and Eliewan for helping me for the coding part