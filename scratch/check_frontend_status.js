(async () => {
  try {
    const res = await fetch('http://localhost:5175/');
    console.log(`Frontend server response on port 5175 (status ${res.status}):`);
    const text = await res.text();
    console.log(text.slice(0, 300) + '...');
  } catch (err) {
    console.error('Failed to connect to frontend server on port 5175:', err.message);
  }
})();
