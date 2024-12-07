require("dotenv").config();
const express = require("express");
const session = require("express-session");
const { TwitterApi } = require("twitter-api-v2");
const axios = require("axios");
const cron = require("node-cron");

// dotenv.config();

const app = express();
const port = 3000;

// Session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET || "yKA-=e]y",
    resave: false,
    saveUninitialized: false,
  })
);

const X_AI_API_KEY = process.env.X_AI_API_KEY;

// Twitter OAuth2 configuration
const CLIENT_ID = process.env.TWITTER_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET;
const CALLBACK_URL = "http://127.0.0.1:3000/callback";

let twitterClient = null;

// Initialize Twitter client
async function initializeTwitterClient(accessToken) {
  return new TwitterApi(accessToken);
}

// Get authentication URL
function getAuthURL() {
  const client = new TwitterApi({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
  });

  return client.generateOAuth2AuthLink(CALLBACK_URL, {
    scope: ["tweet.read", "tweet.write", "users.read"],
  });
}

// Routes
app.get("/", async (req, res) => {
  if (!req.session.accessToken) {
    try {
      const { url, codeVerifier, state } = getAuthURL();
      req.session.codeVerifier = codeVerifier;
      req.session.state = state;
      res.redirect(url);
    } catch (error) {
      console.error("Error generating auth URL:", error);
      res.status(500).send("Authentication failed");
    }
  } else {
    res.send("Bot is authenticated and running!");
  }
});

app.get("/callback", async (req, res) => {
  try {
    const { state, code } = req.query;
    const { codeVerifier, state: sessionState } = req.session;

    if (!codeVerifier || !state || !sessionState || state !== sessionState) {
      return res.status(400).send("Invalid state");
    }

    const client = new TwitterApi({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    const { accessToken, refreshToken } = await client.loginWithOAuth2({
      code,
      codeVerifier,
      redirectUri: CALLBACK_URL,
    });

    req.session.accessToken = accessToken;
    req.session.refreshToken = refreshToken;

    console.log("Access Token:", accessToken);
    console.log("Refresh Token:", refreshToken);

    twitterClient = await initializeTwitterClient(accessToken);
    startBot();

    res.send("Authentication successful! Bot is now running.");
  } catch (error) {
    console.error("Error in callback:", error);
    res.status(500).send("Authentication failed");
  }
});

async function getCoinDetails(coinId) {
  try {
    // Add delay to avoid rate limits
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=true`
    );
    return {
      current_price: response.data.market_data?.current_price?.usd,
      price_change_24h: response.data.market_data?.price_change_percentage_24h,
      market_cap: response.data.market_data?.market_cap?.usd,
      volume_24h: response.data.market_data?.total_volume?.usd,
      description: response.data.description?.en?.split(". ")[0],
      github_commits: response.data.developer_data?.commits_4_weeks || 0,
      github_stars: response.data.developer_data?.stars || 0,
    };
  } catch (error) {
    console.error(`Error fetching details for ${coinId}:`, error);
    return null;
  }
}

async function getTrendingData() {
  try {
    const response = await axios.get(
      "https://api.coingecko.com/api/v3/search/trending?x_cg_demo_api_key=CG-Qzpvnfpy2Su7jeRk83PqezFn"
    );

    const enrichedCoins = await Promise.all(
      response.data.coins.map(async (coin) => {
        const details = await getCoinDetails(coin.item.id);
        return {
          id: coin.item.id,
          name: coin.item.name,
          symbol: coin.item.symbol.toUpperCase(),
          market_cap_rank: coin.item.market_cap_rank || "N/A",
          price_btc: coin.item.price_btc,
          details: details,
        };
      })
    );
    return enrichedCoins;
  } catch (error) {
    console.error("Error fetching trending data:", error);
    return [];
  }
}

function formatPrice(price) {
  if (price === 0) return "";
  if (typeof price !== "number" || isNaN(price)) return "N/A";
  if (price < 0.01) return price.toExponential(2);
  return price.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getMarketAnalysis(coin) {
  const insights = [];

  if (coin.details) {
    if (coin.details.price_change_24h > 5) {
      insights.push(
        `🚀 Strong upward momentum (${coin.details.price_change_24h.toFixed(
          1
        )}% in 24h)`
      );
    } else if (coin.details.price_change_24h < -5) {
      insights.push(
        `📉 Significant price drop (${coin.details.price_change_24h.toFixed(
          1
        )}% in 24h)`
      );
    }

    if (coin.details.github_commits > 100) {
      insights.push("👨‍💻 Very high development activity");
    } else if (coin.details.github_commits > 50) {
      insights.push("👨‍💻 High development activity");
    }

    if (coin.details.volume_24h > coin.details.market_cap * 0.3) {
      insights.push("💹 Exceptionally high trading volume");
    } else if (coin.details.volume_24h > coin.details.market_cap * 0.2) {
      insights.push("💹 High trading volume");
    }

    if (coin.details.github_stars > 5000) {
      insights.push("⭐ Highly popular project");
    } else if (coin.details.github_stars > 1000) {
      insights.push("⭐ Popular project");
    }
  }

  return insights.length > 0
    ? insights.join(" | ")
    : "Trending, but exercise caution";
}

function formatTrendingData(trendingData) {
  const threads = [];
  let mainTweet = `🚀 Crypto Trending Analysis\n\n`;

  trendingData.slice(0, 3).forEach((coin, index) => {
    mainTweet += `${index + 1}. $${coin.symbol}\n`;

    let thread = `🔍 $${coin.symbol} Deep Dive\n\n`;

    const price = formatPrice(coin.details?.current_price);
    if (price) {
      thread += `💰 Price: $${price}\n`;
    }

    if (coin.details?.market_cap > 0) {
      thread += `📊 Market Cap: $${(coin.details.market_cap / 1e6).toFixed(
        2
      )}M\n`;
    }

    thread +=
      `📈 Rank: #${coin.market_cap_rank}\n\n` +
      `${getMarketAnalysis(coin)}\n\n` +
      (coin.details?.description ? `💡 ${coin.details.description}\n\n` : "") +
      `#${coin.symbol} #Crypto`;

    threads.push(thread);
  });

  mainTweet += `\nDetailed analysis in thread 🧵\n#Crypto #Trading`;

  return [mainTweet, ...threads];
}

async function postThreadedTweet(tweets) {
  if (!twitterClient) {
    console.error("Twitter client not initialized");
    return;
  }

  try {
    let lastTweetId = null;
    for (const tweet of tweets) {
      const tweetData = lastTweetId
        ? { text: tweet, reply: { in_reply_to_tweet_id: lastTweetId } }
        : { text: tweet };

      const result = await twitterClient.v2.tweet(tweetData);
      lastTweetId = result.data.id;

      // Add delay between tweets
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    console.log("Thread posted successfully");
  } catch (error) {
    console.error("Error posting thread:", error);
    throw error;
  }
}

async function runBot() {
  try {
    console.log("Fetching trending data...");
    const trendingData = await getTrendingData();

    if (trendingData.length === 0) {
      console.log("No trending data available. Skipping tweet.");
      return;
    }

    const tweetThread = formatTrendingData(trendingData);
    console.log("Posting tweet thread...");
    await postThreadedTweet(tweetThread);
  } catch (error) {
    console.error("Error running bot:", error);
  }
}

function startBot() {
  console.log("Starting crypto twitter bot...");
  runBot();

  // Schedule tweets every 6 hours
  cron.schedule("0 */6 * * *", () => {
    console.log("Running scheduled tweet...");
    runBot();
  });
}

// Start server
app.listen(port, () => {
  console.log(`Server running at http://127.0.0.1:${port}`);
});

// Handle shutdown
process.on("SIGINT", () => {
  console.log("Bot shutting down...");
  process.exit();
});

console.log("Updated Crypto Twitter Bot is running...");
runBot();
