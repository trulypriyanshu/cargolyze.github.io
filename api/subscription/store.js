import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const PADDLE_API_KEY = process.env.PADDLE_API_KEY;

const allowedOrigins = [
  'https://cargolyze.com',
  'https://www.cargolyze.com',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
];

export default async function handler(req, res) {
  // Handle preflight request
  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(200).end();
  }

  // Set CORS headers for actual request
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      transaction_id, 
      customer_id, 
      email,
      price_id,
      plan_name,
      customer_name
    } = req.body;

    if (!transaction_id || !email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get user name from profiles table
    let userName = customer_name || 'Customer';
    
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('email', email)
      .single();
    
    if (!profileError && profile && profile.full_name) {
      userName = profile.full_name;
    }

    // Get transaction details from Paddle
    const transactionResponse = await fetch(`https://api.paddle.com/transactions/${transaction_id}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${PADDLE_API_KEY}`,
        'Content-Type': 'application/json',
      }
    });

    if (!transactionResponse.ok) {
      console.error('Paddle transaction API error:', await transactionResponse.text());
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const transactionData = await transactionResponse.json();
    const transaction = transactionData.data;
    
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Get subscription ID from transaction
    const subscriptionId = transaction.subscription_id;
    
    if (!subscriptionId) {
      return res.status(400).json({ error: 'No subscription found in transaction' });
    }

    // Get subscription details from Paddle
    const subscriptionResponse = await fetch(`https://api.paddle.com/subscriptions/${subscriptionId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${PADDLE_API_KEY}`,
        'Content-Type': 'application/json',
      }
    });

    if (!subscriptionResponse.ok) {
      console.error('Paddle subscription API error:', await subscriptionResponse.text());
      return res.status(404).json({ error: 'Subscription not found' });
    }

    const subscriptionData = await subscriptionResponse.json();
    const subscription = subscriptionData.data;

    // Store subscription in database
    const subscriptionRecord = {
      user_email: email,
      user_name: userName,
      subscription_id: subscription.id,
      transaction_id: transaction_id,
      paddle_customer_id: customer_id || subscription.customer_id,
      status: subscription.status,
      product_id: product_id || subscription.items[0]?.price?.product_id,
      plan_id: price_id || subscription.items[0]?.price?.id,
      plan_name: plan_name || subscription.items[0]?.price?.name,
      billing_cycle: subscription.billing_cycle?.interval || 'month',
      quantity: subscription.items[0]?.quantity || 1,
      trial_starts_at: subscription.trial_dates?.starts_at || null,
      trial_ends_at: subscription.trial_dates?.ends_at || null,
      current_billing_starts_at: subscription.current_billing_period?.starts_at,
      current_billing_ends_at: subscription.current_billing_period?.ends_at,
      next_billed_at: subscription.next_billed_at,
      canceled_at: subscription.canceled_at,
      paused_at: subscription.paused_at,
      created_at: subscription.created_at,
      updated_at: subscription.updated_at,
      raw_data: subscription
    };

    const { data: storedSubscription, error: subscriptionError } = await supabase
      .from('subscriptions')
      .upsert(subscriptionRecord, {
        onConflict: 'subscription_id'
      })
      .select()
      .single();

    if (subscriptionError) {
      console.error('Error storing subscription:', subscriptionError);
      return res.status(500).json({ error: 'Failed to store subscription' });
    }

    return res.status(200).json({
      success: true,
      subscription: storedSubscription,
      message: 'Subscription stored successfully'
    });

  } catch (error) {
    console.error('Error in store subscription:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
