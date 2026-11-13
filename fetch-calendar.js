import { setTimeout as pause } from 'node:timers/promises';

export async function fetchCalendar(url, request = fetch) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await request(url,{signal:AbortSignal.timeout(12000)});
      if (response.ok) return await response.text();
      if (attempt || ![408,429,500,502,503,504].includes(response.status)) {
        throw Object.assign(new Error('HTTP '+response.status),{http:true});
      }
    } catch (error) {
      if (attempt || error.http) {
        const detail = error.cause?.code || error.message;
        throw new Error(new URL(url).hostname+' '+new URL(url).pathname+': '+detail);
      }
    }
    await pause(750);
  }
}
