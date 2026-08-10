(async () => {
  try {
    const res = await fetch('http://localhost:5001/api/auth/me');
    console.log(`Backend auth/me response (status ${res.status}):`);
    const json = await res.json();
    console.log(JSON.stringify(json, null, 2));
  } catch (err) {
    console.error('Failed to call backend auth/me:', err.message);
  }
})();
