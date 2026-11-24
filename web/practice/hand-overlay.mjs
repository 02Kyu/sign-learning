function visible(point) {
  return point && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

function drawHand(context, landmarks, connections, color) {
  if (!landmarks?.length) return;
  const { width, height } = context.canvas;
  const unit = Math.max(1, width / 640);

  context.beginPath();
  for (const [from, to] of connections) {
    const a = landmarks[from];
    const b = landmarks[to];
    if (!visible(a) || !visible(b)) continue;
    context.moveTo(a.x * width, a.y * height);
    context.lineTo(b.x * width, b.y * height);
  }
  context.lineCap = 'round';
  context.strokeStyle = '#102536';
  context.lineWidth = 5 * unit;
  context.stroke();
  context.strokeStyle = color;
  context.lineWidth = 2.5 * unit;
  context.stroke();

  context.fillStyle = color;
  context.strokeStyle = '#102536';
  context.lineWidth = 1.7 * unit;
  for (const [index, point] of landmarks.entries()) {
    if (!visible(point)) continue;
    context.beginPath();
    const radius = index % 4 === 0 ? 4.8 : 3.4;
    context.arc(point.x * width, point.y * height, radius * unit, 0, 2 * Math.PI);
    context.fill();
    context.stroke();
  }
}

export function drawHandOverlay(context, results, connections) {
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  drawHand(context, results.leftHandLandmarks, connections, '#ffc65a');
  drawHand(context, results.rightHandLandmarks, connections, '#42e8c4');
}
