export function calculateOutstanding(principal: number, interest: number, penalty: number) {
  return principal + interest + penalty;
}

export function calculateOverdueRate(overdueCount: number, activeCount: number) {
  if (activeCount === 0) return 0;
  return (overdueCount / activeCount) * 100;
}

export function calculateCollectionEfficiency(collectedToday: number, dueToday: number) {
  if (dueToday === 0) return 100;
  return (collectedToday / dueToday) * 100;
}