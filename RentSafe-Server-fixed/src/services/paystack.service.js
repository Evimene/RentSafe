import axios from "axios";
import { config } from "../config.js";


const client = axios.create({
  baseURL: config.paystack.baseUrl,
  headers: {
    Authorization: `Bearer ${config.paystack.secretKey}`,
    'Content-Type': 'application/json',
  },
});


export async function createCustomer({ email, firstName, lastName, phone }) {
  if (!config.paystack.secretKey) return { dev: true };
  const { data } = await client.post('/customer', {
    email, first_name: firstName, last_name: lastName, phone,
  });

  return data?.data;
}


export async function resolveBankAccount({ accountNumber, bankCode }) {
  const { data } = await client.get('/bank/resolve', {
    params: { account_number: accountNumber, bank_code: bankCode },
  });

  return data?.data;
}


export async function matchBvn({ bvn, firstName, lastName }) {
  if (!config.paystack.secretKey) return { dev: true };
  const { data } = await client.post('/bnv/match', {
    bvn, first_name: firstName, last_name: lastName,
  });

  return data?.data;
}