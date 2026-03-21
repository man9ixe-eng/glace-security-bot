const axios = require("axios");

const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;

async function createCard(listId, name, desc="") {
  return axios.post("https://api.trello.com/1/cards", {
    name,
    desc,
    idList: listId,
    key: TRELLO_KEY,
    token: TRELLO_TOKEN
  });
}

module.exports = {
  createCard
};