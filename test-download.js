async function test() {
  console.log("Fetching info...");
  const res = await fetch("http://127.0.0.1:3000/api/info", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ url: "https://www.youtube.com/watch?v=kZnpzY7A1u4" })
  });
  const data = await res.json();
  
  if (!data.requestId) return;
  
  console.log("Starting conversion (Audio)...");
  const convRes = await fetch(`http://127.0.0.1:3000/api/convert/audio?id=${data.requestId}`);
  console.log("Convert HTTP status:", convRes.status);
  const convData = await convRes.text();
  console.log("Convert output:", convData);
}
test().catch(console.error);
