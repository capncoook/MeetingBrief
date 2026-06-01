// server.js (ES module)
import express from 'express';
import multer from 'multer';
import axios from 'axios';
import Stripe from 'stripe';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: '.env.local' });

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2022-11-15' });

const app = express();

// Middleware
app.use(express.json());
app.use(express.static('public'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

// Simple in-memory database (replace with Supabase in production)
const users = new Map();
const recordings = new Map();

// ===== DEEPGRAM TRANSCRIPTION =====
async function transcribeAudio(audioBuffer) {
  try {
    const response = await axios.post(
      'https://api.deepgram.com/v1/listen',
      audioBuffer,
      {
        headers: {
          'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`,
          'Content-Type': 'audio/wav'
        },
        params: {
          model: 'nova-2',
          smart_format: true,
          paragraphs: true
        }
      }
    );

    return response.data.results.channels[0].alternatives[0].transcript;
  } catch (error) {
    console.error('Deepgram error:', error?.response?.data || error.message);
    throw new Error('Transcription failed');
  }
}

// ===== CLAUDE AI EXTRACTION =====
async function extractActionItems(transcript) {
  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-opus-4-1-20250805',
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: `Analyze this meeting transcript and extract the following in JSON format:
{
  "keyDecisions": ["decision 1", "decision 2"],
  "actionItems": [
    {
      "task": "task description",
      "owner": "person name or null",
      "deadline": "mentioned deadline or null"
    }
  ],
  "topics": ["topic1", "topic2"],
  "summary": "2-3 sentence summary"
}

Transcript:
${transcript}

Return ONLY valid JSON, no other text.`
          }
        ]
      },
      {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    // Adjust depending on Anthropic response shape
    const content = response.data?.content?.[0]?.text ?? response.data?.choices?.[0]?.message?.content ?? '';
    return JSON.parse(content);
  } catch (error) {
    console.error('Claude error:', error?.response?.data || error.message);
    return {
      keyDecisions: [],
      actionItems: [],
      topics: [],
      summary: 'Unable to extract details'
    };
  }
}

// ===== SEND EMAIL =====
async function sendSummaryEmail(email, summary) {
  try {
    const transporter = nodemailer.createTransport({
      service: 'SendGrid',
      auth: {
        user: 'apikey',
        pass: process.env.SENDGRID_API_KEY
      }
    });

    const htmlContent = `
      <h2>Your Meeting Summary</h2>
      <p>${summary.summary}</p>
      
      ${summary.keyDecisions?.length > 0 ? `
        <h3>Key Decisions</h3>
        <ul>
          ${summary.keyDecisions.map(d => `<li>${d}</li>`).join('')}
        </ul>
      ` : ''}

      ${summary.actionItems?.length > 0 ? `
        <h3>Action Items</h3>
        <ul>
          ${summary.actionItems.map(item => `
            <li>
              <strong>${item.task}</strong>
              ${item.owner ? `<br/>Owner: ${item.owner}` : ''}
              ${item.deadline ? `<br/>Due: ${item.deadline}` : ''}
            </li>
          `).join('')}
        </ul>
      ` : ''}

      <p><small>Sent by MeetingBrief</small></p>
    `;

    await transporter.sendMail({
      from: 'noreply@meetingbrief.ai',
      to: email,
      subject: 'Your Meeting Summary',
      html: htmlContent
    });

    return true;
  } catch (error) {
    console.error('Email error:', error?.response?.data || error.message);
    return false;
  }
}

// ===== API ENDPOINTS =====
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/process-audio', upload.single('file'), async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !req.file) {
      return res.status(400).json({ error: 'Email and audio file required' });
    }

    if (!users.has(email)) {
      users.set(email, { plan: 'free', recordingsThisMonth: 0 });
    }

    const user = users.get(email);
    if (user.plan === 'free' && user.recordingsThisMonth >= 3) {
      return res.status(403).json({
        error: 'Recording limit reached. Upgrade to Pro for unlimited recordings.'
      });
    }

    console.log('Transcribing audio...');
    const transcript = await transcribeAudio(req.file.buffer);

    console.log('Extracting action items...');
    const extraction = await extractActionItems(transcript);

    const recordingId = Date.now();
    recordings.set(recordingId, {
      email,
      transcript,
      summary: extraction,
      date: new Date(),
      status: 'completed'
    });

    user.recordingsThisMonth += 1;

    console.log('Sending email...');
    await sendSummaryEmail(email, extraction);

    res.json({
      success: true,
      recordingId,
      summary: {
        transcript,
        ...extraction
      }
    });
  } catch (error) {
    console.error('Processing error:', error);
    res.status(500).json({
      error: error.message || 'Processing failed',
      success: false
    });
  }
});

app.get('/api/recordings/:email', (req, res) => {
  const { email } = req.params;
  const userRecordings = Array.from(recordings.values())
    .filter(r => r.email === email)
    .sort((a, b) => b.date - a.date);

  res.json({
    recordings: userRecordings,
    limit: users.get(email)?.plan === 'pro' ? 'unlimited' : '3/month'
  });
});

app.post('/api/create-checkout', async (req, res) => {
  try {
    const { email, plan } = req.body;
    const priceMap = {
      pro: 'price_pro_monthly',
      team: 'price_team_monthly'
    };

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceMap[plan], quantity: 1 }],
      customer_email: email,
      success_url: `${process.env.DOMAIN}/dashboard?success=true`,
      cancel_url: `${process.env.DOMAIN}/dashboard`,
      metadata: { email, plan }
    });

    res.json({ sessionId: session.id });
  } catch (error) {
    console.error('Checkout error:', error);
    res.status(500).json({ error: 'Checkout failed' });
  }
});

app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);

    if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      const { email, plan } = event.data.object.metadata;
      const user = users.get(email) || { recordingsThisMonth: 0 };
      user.plan = plan;
      users.set(email, user);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(400).json({ error: 'Webhook failed' });
  }
});

app.get('/api/account/:email', (req, res) => {
  const { email } = req.params;
  const user = users.get(email);
  if (!user) return res.status(404).json({ error: 'User not found' });

  res.json({
    email,
    plan: user.plan || 'free',
    recordingsThisMonth: user.recordingsThisMonth || 0,
    recordingLimit: user.plan === 'free' ? 3 : (user.plan === 'pro' ? 50 : 'unlimited')
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`MeetingBrief API running on port ${PORT}`);
  console.log('Endpoints: POST /api/process-audio, GET /api/recordings/:email, POST /api/create-checkout, GET /api/account/:email');
});
