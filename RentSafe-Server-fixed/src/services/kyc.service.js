import axios from "axios";
import { config } from "../config.js";

export async function verifyIdentity({ type, payload }) {
  switch (config.kyc.provider) {
    case 'mock': return mockVerify({ type, payload });
    case 'dojah': return dojahVerify(type, payload);
    case 'prembly': return premblyVerify(type, payload);
    default: throw new Error(`Unknown KYC provider: ${config.kyc.provider}`);
  }
}


async function mockVerify({ type, payload }) {
  const ok = Boolean(payload?.number) && String(payload.number).length >= 6;
  return {
    provider: 'mock',
    reference: `mock_${Date.now()}`,
    success: ok,
    status: ok ? 'verified' : 'rejected',
    reason: ok ? null : 'Invalid number',

    data: {
      type,
      matched: ok,
      firstName: payload?.firstName || 'TEST',
      lastName: payload?.lastName || 'USER',
    },
  };
  
}


async function dojahVerify(type, payload) {
  if (type === 'nin') {
    const { data } = await axios.get(`${config.kyc.dojah.baseUrl}/api/v1/kyc/nin`, {
      params: {
        nin: payload.number,
        first_name: payload.firstName,
        last_name: payload.lastName,
        dob: payload.dob,
      },

      headers: {
        AppId: config.kyc.dojah.appId,
        Authorization: config.kyc.dojah.apiKey,
      },
    });

    const entity = data?.entity || {};
    const matched = Boolean(entity?.nin);
    return {
      provider: 'dojah',
      reference: data?.reference || `dojah_${Date.now()}`,
      success: matched,
      status: matched ? null : 'NIN not found or details mismatch',
      data: entity,
    };
  }

  if ( type === 'bvn') {
    const { data } = await axios.get(`${config.kyc.dojah.baseUrl}/api/v1/kyc/bvn`, {
      params: {
        bvn: payload.number,
        first_name: payload.firstName,
        last_name: payload.lastName,

      },

      headers: {
        AppId: config.kyc.dojah.appId,
        Authorization: config.kyc.dojah.apiKey,

      },
    });

    const entity = data?.entity || {};
    const matched = Boolean(entity?.bvn);

    return {
      provider: 'dojah',
      reference: data?.reference || `dojah_${Date.now()}`,
      success: matched,
      status: matched ? 'verified' : 'rejected',
      reason: matched ? null : 'BVN not found or mismatch',
      data: entity,
    };
  }
  throw new Error(`Dojah: Unsupported type ${type}`);
  
}



async function premblyVerify(type, payload) {
  const endpoint = type === 'nin' ? 'nin' : 'bvn';
  const { data } = await axios.post(
    `${config.kyc.prembly.baseUrl}/identitypass/verification/${endpoint}`, {
      number: payload.number,
      first_name: payload.firstName,
      last_name: payload.lastName,
      dob: payload.dob,
    },
    {
      headers: {
        'x-api-key': config.kyc.prembly.apiKey,
        'app-id': config.kyc.prembly.appId,
      },
    }
  );

  const ok = Boolean(data?.status);
  return {
    provider: 'prembly',
    reference: data?.verification?.reference || `prembly_${Date.now()}`,
    success: ok,
    status: ok ? 'verified' : 'rejected',
    reason: ok ? null : data?.detail || 'verification failed',
    data: data.verification || data,
  };
}
