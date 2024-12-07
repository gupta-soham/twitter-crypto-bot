// server.js
require("dotenv").config();
const express = require("express");
const { TwitterApi } = require("twitter-api-v2");

const app = express();
const port = 3000;

// OAuth 2.0 credentials
const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID;
const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET;
const CALLBACK_URL = "http://127.0.0.1:3000/callback";

// Initialize Twitter client
const client = new TwitterApi({
  clientId: TWITTER_CLIENT_ID,
  clientSecret: TWITTER_CLIENT_SECRET,
});

// Store these temporarily (in a real app, use a database or session storage)
let codeVerifier;
let state;

app.get("/", async (req, res) => {
  try {
    // Generate auth link
    const {
      url,
      state: newState,
      codeVerifier: newCodeVerifier,
    } = await client.generateOAuth2AuthLink(CALLBACK_URL, {
      scope: ["tweet.read", "tweet.write", "users.read"],
    });

    // Store the state and codeVerifier
    state = newState;
    codeVerifier = newCodeVerifier;

    res.send(`<a href="${url}">Connect to Twitter</a>`);
  } catch (error) {
    console.error("Error generating auth link:", error);
    res.status(500).send("Error generating auth link");
  }
});

app.get("/callback", async (req, res) => {
  try {
    const { code, state: receivedState } = req.query;

    // Verify state matches to prevent CSRF attacks
    if (state !== receivedState) {
      return res.status(400).send("Stored tokens do not match.");
    }

    const {
      client: loggedClient,
      accessToken,
      refreshToken,
    } = await client.loginWithOAuth2({
      code: code.toString(),
      codeVerifier,
      redirectUri: CALLBACK_URL,
    });

    // Store these tokens securely in a real application
    console.log("Access Token:", accessToken);
    console.log("Refresh Token:", refreshToken);

    // Post a tweet
    const tweet = await loggedClient.v2.tweet("Hello World!");
    res.send(`Tweet posted successfully! Tweet ID: ${tweet.data.id}`);
  } catch (error) {
    console.error("Error in callback:", error);
    res.status(500).send("Error during Twitter authentication");
  }
});

app.listen(port, () => {
  console.log(`Server running at http://127.0.0.1:${port}`);
});
