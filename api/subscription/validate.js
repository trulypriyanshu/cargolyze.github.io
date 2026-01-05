// /api/subscription/validate.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// CORS headers configuration
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://cargolyze.com',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Max-Age': '86400',
};

export default async function handler(req, res) {
  // Handle OPTIONS request (preflight)
  if (req.method === 'OPTIONS') {
    return res.status(200).setHeaders(corsHeaders).end();
  }

  // Set CORS headers for all responses
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Step 1: Get user's name from profiles table
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('full_name, id')
      .eq('email', email)
      .single();

    let userName = 'Customer';
    if (!profileError && profile && profile.full_name) {
      userName = profile.full_name;
    }

    // Step 2: Get user's active subscriptions
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

    // Step 3: Check if any subscription is currently valid
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

    // Step 4: Return subscription details
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