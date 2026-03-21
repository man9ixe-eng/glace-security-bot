function getNextMonthDate(dateStr) {
  const date = new Date(dateStr);
  date.setMonth(date.getMonth() + 1);
  return date.toISOString();
}

module.exports = { getNextMonthDate };