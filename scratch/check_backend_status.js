(async () => {
  try {
    const res = await fetch('http://localhost:5001/');
    const text = await res.text();
    console.log(`Backend server response on port 5001 (status ${res.status}):`);
    console.log(text);
  } catch (err) {
    console.error('Failed to connect to backend server on port 5001:', err.message);
  }
})();
