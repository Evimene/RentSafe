import axios from 'axios';
import { config } from '../config.js';

export async function sendSms({ to, message }) {
  if (config.nodeEnv !== 'production') {
    console.log(`[SMS:dev] to=${to} message=${message}`);
    return { dev: true };
  }

  if (!config.termii.apiKey) {
    throw new Error('TERMII_API_KEY is required when NODE_ENV=production');
  }


  const { data } = await axios.post(`${config.termii.baseUrl}/api/sms/send`, {
    to,
    from: config.termii.senderId,
    sms: message,
    type: 'plain',
    channel: 'generic',
    api_key: config.termii.apiKey,
  });

  return data;
}


export const otpMessage = (code) => 
  `Your Dwellvibes verification code is ${code}. It expires in ${config.otp.ttlMinutes} minutes.
Do not share it with anyone.`;