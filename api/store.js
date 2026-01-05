// /api/subscription/store.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;  // Use anon key for public access
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const PADDLE_API_KEY = process.env.PADDLE_API_KEY;

export default async function handler(req, res) {
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
      customer_name  // Add this parameter from checkout
    } = req.body;

    if (!transaction_id || !email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Step 1: Get user name from profiles table using anon key
    let userName = customer_name || 'Customer';
    
    // Try to get name from profiles table
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('email', email)
      .single();
    
    if (!profileError && profile && profile.full_name) {
      userName = profile.full_name;
    } else {
      // If no profile exists, try to get from auth.users using admin API
      // Note: This requires service role key, so use a different approach
      // For now, use the provided customer_name or 'Customer'
    }

    // Step 2: Get transaction details from Paddle (using server-side API)
    const transactionResponse = await fetch('https://api.paddle.com/transactions', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${PADDLE_API_KEY}`,
        'Content-Type': 'application/json',
      }
    });

    const transactionsData = await transactionResponse.json();
    const transaction = transactionsData.data.find(t => t.id === transaction_id);
    
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Step 3: Get subscription ID from transaction
    const subscriptionId = transaction.subscription_id;
    
    if (!subscriptionId) {
      return res.status(400).json({ error: 'No subscription found in transaction' });
    }

    // Step 4: Get subscription details from Paddle
    const subscriptionResponse = await fetch(`https://api.paddle.com/subscriptions/${subscriptionId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${PADDLE_API_KEY}`,
        'Content-Type': 'application/json',
      }
    });

    const subscriptionData = await subscriptionResponse.json();
    const subscription = subscriptionData.data;

    // Step 5: Store subscription in database
    const subscriptionRecord = {
      user_email: email,
      user_name: userName,  // Store name for quick access
      subscription_id: subscription.id,
      transaction_id: transaction_id,
      paddle_customer_id: customer_id || subscription.customer_id,
      status: subscription.status,
      plan_id: price_id || subscription.items[0]?.price?.id,
      plan_name: plan_name || subscription.items[0]?.price?.description,
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