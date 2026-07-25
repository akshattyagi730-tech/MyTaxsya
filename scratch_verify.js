import { createClient } from "@base44/sdk";

const base44 = createClient({
  appId: "6a60f79044ffed1e19fd926b",
  serverUrl: "http://localhost:4400",
  appBaseUrl: "http://localhost:4400"
});

async function main() {
  try {
    console.log("Verifying OTP...");
    const result = await base44.auth.verifyOtp({
      email: "testuser2@example.com",
      otpCode: "539430"
    });
    console.log("OTP verify result:", result);

    console.log("Attempting login...");
    const loginRes = await base44.auth.loginViaEmailPassword("testuser2@example.com", "Password123");
    console.log("Login result:", loginRes);
  } catch (e) {
    console.error("Error:", e.message || e);
    if (e.response) {
      console.error("Response data:", e.response.data);
    }
  }
}

main();
