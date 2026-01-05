import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Get user's name from profiles table
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('full_name, id')
      .eq('email', email)
      .single();

    let userName = 'Customer';
    if (!profileError && profile && profile.full_name) {
      userName = profile.full_name;
    }

    // Get user's active subscriptions
    const { data: subscriptions, error: subscriptionError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_email', email)
      .in('status', ['active', 'trialing'])
      .order('created_at', { ascending: false });

    if (subscriptionError) {
      console.error('Error fetching subscriptions:', subscriptionError);
      return res.status(500).json({ error: 'Failed to fetch subscriptions' });
    }

    // Check if any subscription is currently valid
    const now = new Date();
    let activeSubscription = null;

    for (const subscription of subscriptions) {
      // Check if subscription hasn't expired
      const endsAt = new Date(subscription.current_billing_ends_at);
      
      if (endsAt > now) {
        activeSubscription = subscription;
        break;
      }
    }

    if (!activeSubscription) {
      return res.json({
        valid: false,
        message: 'No active subscription found',
        user: {
          email: email,
          name: userName
        }
      });
    }

    // Return subscription details
    return res.json({
      valid: true,
      subscription: {
        id: activeSubscription.subscription_id,
        status: activeSubscription.status,
        plan_name: activeSubscription.plan_name,
        user_name: activeSubscription.user_name || userName,
        trial_ends_at: activeSubscription.trial_ends_at,
        current_billing_ends_at: activeSubscription.current_billing_ends_at,
        next_billed_at: activeSubscription.next_billed_at,
        billing_cycle: activeSubscription.billing_cycle
      },
      user: {
        email: email,
        name: activeSubscription.user_name || userName
      }
    });

  } catch (error) {
    console.error('Error validating subscription:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}