(async () => {
  try {
    const res = await fetch('http://localhost:5175/api/auth/me');
    console.log(`Frontend proxy response for /api/auth/me (status ${res.status}):`);
    const json = await res.json();
    console.log(JSON.stringify(json, null, 2));
  } catch (err) {
    console.error('Failed to connect to proxy for /api/auth/me:', err.message);
  }
})();
