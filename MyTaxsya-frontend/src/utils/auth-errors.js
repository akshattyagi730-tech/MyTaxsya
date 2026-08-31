export function translateAuthError(error) {
  if (!error) return "An unknown error occurred";
  
  // Base44 SDK error format often includes .status
  const status = error.status || (error.response && error.response.status);
  const message = error.message || "";
  
  if (status === 401) {
    return "Invalid email or password";
  }
  if (status === 403) {
    return "Email not verified or account disabled";
  }
  if (status === 404) {
    return "Account does not exist";
  }
  if (status === 419 || message.toLowerCase().includes("session expired") || message.toLowerCase().includes("token expired")) {
    return "Session expired";
  }
  if (status >= 500 || message.toLowerCase().includes("network error") || message.toLowerCase().includes("unavailable")) {
    return "Authentication server unavailable";
  }
  return error.message || "An unexpected error occurred during authentication";
}
