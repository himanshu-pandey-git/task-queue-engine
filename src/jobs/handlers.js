function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendEmail(payload) {
  const { to, subject } = payload;
  if (!to || !subject) throw new Error("Missing required fields: to, subject");

  await sleep(Math.random() * 500 + 100);

  if (Math.random() < 0.1)
    throw new Error("Email provider timed out (simulated)");

  console.log(`[Handler] Email sent to ${to}: "${subject}"`);
  return { sent: true, to, timestamp: new Date().toISOString() };
}

async function resizeImage(payload) {
  const { imageUrl, width, height } = payload;
  if (!imageUrl) throw new Error("imageUrl is required");

  await sleep(Math.random() * 1000 + 200);

  console.log(`[Handler] Resized ${imageUrl} → ${width}x${height}`);
  return {
    original: imageUrl,
    resized: `${imageUrl}?w=${width}&h=${height}`,
    processedAt: new Date().toISOString(),
  };
}

async function generateReport(payload) {
  const { reportType, userId } = payload;

  await sleep(Math.random() * 2000 + 500);

  console.log(`[Handler] Generated ${reportType} report for user ${userId}`);
  return {
    reportType,
    userId,
    url: `https://reports.example.com/${userId}/${reportType}-${Date.now()}.pdf`,
    generatedAt: new Date().toISOString(),
  };
}

const handlers = {
  send_email: sendEmail,
  resize_image: resizeImage,
  generate_report: generateReport,
};

module.exports = { handlers };
