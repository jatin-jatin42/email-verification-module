const express = require('express');
const cors = require('cors');
const { verifyEmail, getDidYouMean } = require('../src/index');

const app = express();

// Enable CORS so frontends can call this API
app.use(cors());
app.use(express.json());

// Root endpoint just to show the API is alive
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    message: 'Email Verification Module API is running.',
    endpoints: {
      '/api/verify': 'GET - Requires ?email= query parameter'
    }
  });
});

// Verification Endpoint
app.get('/api/verify', async (req, res) => {
  const email = req.query.email;

  if (!email) {
    return res.status(400).json({
      error: 'Missing email parameter. Usage: /api/verify?email=user@example.com'
    });
  }

  try {
    const result = await verifyEmail(email);
    // You can also include the suggestion directly if it's a typo
    const typoCheck = getDidYouMean(email);
    if (typoCheck && !result.didyoumean) {
      result.didyoumean = typoCheck;
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

// Export the Express app as a module for Vercel Serverless Functions
module.exports = app;

// Listen on a port if running locally (not in Vercel)
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
