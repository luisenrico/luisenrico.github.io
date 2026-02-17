"use strict";

const BOARD_SIZE = 8;

const EMPTY = 0;
const HUMAN_MAN = 1;
const AI_MAN = 2;
const HUMAN_KING = 3;
const AI_KING = 4;

const DIAGONALS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1]
];

const STORAGE_KEYS = {
  stats: "filipino_checkers_stats_v1",
  rl: "filipino_checkers_rl_v1"
};

function makeDefaultStats() {
  return {
    humanWins: 0,
    aiWins: 0,
    draws: 0,
    games: 0,
    currentStreak: 0,
    bestStreak: 0
  };
}

function makeDefaultRl() {
  return {
    alpha: 0.22,
    gamma: 0.92,
    epsilon: 0.2,
    minEpsilon: 0.03,
    epsilonDecay: 0.985,
    games: 0,
    q: {}
  };
}

let stats = loadStats();
let rl = loadRl();

let board = [];
let turn = "human";
let selectedCell = null;
let forcedPiece = null;
let legalMoves = [];
let gameOver = false;
let halfMoveClock = 0;
let statusMessage = "";
let aiEpisode = [];

const boardEl = document.getElementById("board");
const statusTextEl = document.getElementById("statusText");
const prideWinsEl = document.getElementById("prideWins");
const aiWinsEl = document.getElementById("aiWins");
const drawsEl = document.getElementById("draws");
const bestStreakEl = document.getElementById("bestStreak");
const gamesPlayedEl = document.getElementById("gamesPlayed");
const currentStreakEl = document.getElementById("currentStreak");
const epsilonValueEl = document.getElementById("epsilonValue");
const stateCountEl = document.getElementById("stateCount");

const newGameBtn = document.getElementById("newGameBtn");
const resetAiBtn = document.getElementById("resetAiBtn");
const resetStatsBtn = document.getElementById("resetStatsBtn");

bindEvents();
startNewGame("Your turn. Select a piece.");

function bindEvents() {
  boardEl.addEventListener("click", onBoardClick);
  newGameBtn.addEventListener("click", () => startNewGame("New game started. Your turn."));

  resetAiBtn.addEventListener("click", () => {
    const ok = window.confirm("Reset AI memory and learned states?");
    if (!ok) {
      return;
    }

    rl = makeDefaultRl();
    aiEpisode = [];
    saveRl();
    statusMessage = "AI memory reset. It will relearn from your games.";
    render();
  });

  resetStatsBtn.addEventListener("click", () => {
    const ok = window.confirm("Reset your win stats?");
    if (!ok) {
      return;
    }

    stats = makeDefaultStats();
    saveStats();
    statusMessage = "Win stats reset.";
    render();
  });
}

function startNewGame(message) {
  board = createInitialBoard();
  turn = "human";
  selectedCell = null;
  forcedPiece = null;
  legalMoves = getAllMoves(board, "human");
  gameOver = false;
  halfMoveClock = 0;
  aiEpisode = [];
  statusMessage = message || "Your turn.";
  render();
}

function createInitialBoard() {
  const nextBoard = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(EMPTY));

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (!isDarkSquare(row, col)) {
        continue;
      }

      if (row < 3) {
        nextBoard[row][col] = AI_MAN;
      } else if (row > 4) {
        nextBoard[row][col] = HUMAN_MAN;
      }
    }
  }

  return nextBoard;
}

function onBoardClick(event) {
  if (gameOver || turn !== "human") {
    return;
  }

  const cell = event.target.closest(".cell");
  if (!cell || !boardEl.contains(cell)) {
    return;
  }

  const row = Number(cell.dataset.r);
  const col = Number(cell.dataset.c);

  const selectedMove = findMoveFromSelected(row, col);
  if (selectedMove) {
    playHumanMove(selectedMove);
    return;
  }

  const movesFromCell = legalMoves.filter((move) => move.from.r === row && move.from.c === col);
  if (movesFromCell.length > 0) {
    selectedCell = { r: row, c: col };
    statusMessage = forcedPiece ? "Capture chain: continue with this piece." : "Select a highlighted landing square.";
    render();
    return;
  }

  selectedCell = null;
  statusMessage = legalMoves.some((move) => move.isCapture)
    ? "Capture is mandatory. Pick a piece that can capture."
    : "Select a piece.";
  render();
}

function findMoveFromSelected(targetRow, targetCol) {
  if (!selectedCell) {
    return null;
  }

  return legalMoves.find(
    (move) =>
      move.from.r === selectedCell.r &&
      move.from.c === selectedCell.c &&
      move.to.r === targetRow &&
      move.to.c === targetCol
  ) || null;
}

function playHumanMove(move) {
  applyMove(board, move);

  const winnerAfterMove = detectWinner(board, halfMoveClock);
  if (winnerAfterMove) {
    finishGame(winnerAfterMove);
    return;
  }

  if (move.isCapture) {
    const followUpCaptures = getAllMoves(board, "human", move.to).filter((candidate) => candidate.isCapture);
    if (followUpCaptures.length > 0) {
      forcedPiece = { r: move.to.r, c: move.to.c };
      selectedCell = { r: move.to.r, c: move.to.c };
      legalMoves = followUpCaptures;
      statusMessage = "Capture chain: continue jumping with the highlighted piece.";
      render();
      return;
    }
  }

  turn = "ai";
  forcedPiece = null;
  selectedCell = null;
  legalMoves = [];
  statusMessage = "AI is thinking...";
  render();
  window.setTimeout(runAiTurn, 320);
}

function runAiTurn() {
  if (gameOver || turn !== "ai") {
    return;
  }

  let chainFrom = null;
  let guard = 0;

  while (true) {
    guard += 1;
    if (guard > 32) {
      finishGame("draw", "Move loop safety stop.");
      return;
    }

    const moves = getAllMoves(board, "ai", chainFrom);
    if (moves.length === 0) {
      finishGame("human", "AI has no legal moves.");
      return;
    }

    const stateKey = serializeState(board, chainFrom);
    const picked = pickAiMove(stateKey, moves);
    const materialBefore = evaluateMaterial(board);
    applyMove(board, picked.move);
    const materialAfter = evaluateMaterial(board);

    aiEpisode.push({
      state: stateKey,
      action: picked.actionKey,
      reward: materialAfter - materialBefore
    });

    const winnerAfterMove = detectWinner(board, halfMoveClock);
    if (winnerAfterMove) {
      finishGame(winnerAfterMove);
      return;
    }

    if (picked.move.isCapture) {
      const nextCaptures = getAllMoves(board, "ai", picked.move.to).filter((candidate) => candidate.isCapture);
      if (nextCaptures.length > 0) {
        chainFrom = { r: picked.move.to.r, c: picked.move.to.c };
        continue;
      }
    }

    break;
  }

  turn = "human";
  forcedPiece = null;
  selectedCell = null;
  legalMoves = getAllMoves(board, "human");

  if (legalMoves.length === 0) {
    finishGame("ai", "You have no legal moves.");
    return;
  }

  statusMessage = legalMoves.some((move) => move.isCapture)
    ? "Your turn. Capture is mandatory."
    : "Your turn. Select a piece.";
  render();
}

function finishGame(winner, reason) {
  if (gameOver) {
    return;
  }

  gameOver = true;
  turn = "done";
  legalMoves = [];
  selectedCell = null;
  forcedPiece = null;

  if (winner === "human") {
    stats.humanWins += 1;
    stats.currentStreak += 1;
    stats.bestStreak = Math.max(stats.bestStreak, stats.currentStreak);
  } else if (winner === "ai") {
    stats.aiWins += 1;
    stats.currentStreak = 0;
  } else {
    stats.draws += 1;
    stats.currentStreak = 0;
  }

  stats.games += 1;
  saveStats();
  trainAiFromEpisode(winner);
  saveRl();

  if (winner === "human") {
    statusMessage = `You win! ${reason || "Point for your pride score."}`;
  } else if (winner === "ai") {
    statusMessage = `AI wins. ${reason || "Try to outplay it next game."}`;
  } else {
    statusMessage = `Draw game. ${reason || "Start another round."}`;
  }

  render();
}

function trainAiFromEpisode(winner) {
  if (aiEpisode.length === 0) {
    return;
  }

  let terminalReward = 0;
  if (winner === "ai") {
    terminalReward = 8;
  } else if (winner === "human") {
    terminalReward = -8;
  }

  let discountedReturn = terminalReward;
  for (let i = aiEpisode.length - 1; i >= 0; i -= 1) {
    const step = aiEpisode[i];
    discountedReturn = step.reward + rl.gamma * discountedReturn;
    const current = getQValue(step.state, step.action);
    const updated = current + rl.alpha * (discountedReturn - current);
    setQValue(step.state, step.action, Number(updated.toFixed(5)));
  }

  rl.games += 1;
  rl.epsilon = Math.max(rl.minEpsilon, rl.epsilon * rl.epsilonDecay);
  aiEpisode = [];
}

function detectWinner(boardState, moveClock) {
  let humanCount = 0;
  let aiCount = 0;

  for (const row of boardState) {
    for (const piece of row) {
      if (isHumanPiece(piece)) {
        humanCount += 1;
      } else if (isAiPiece(piece)) {
        aiCount += 1;
      }
    }
  }

  if (humanCount === 0) {
    return "ai";
  }
  if (aiCount === 0) {
    return "human";
  }
  if (getAllMoves(boardState, "human").length === 0) {
    return "ai";
  }
  if (getAllMoves(boardState, "ai").length === 0) {
    return "human";
  }
  if (moveClock >= 120) {
    return "draw";
  }

  return null;
}

function getAllMoves(boardState, player, forcedFrom) {
  if (forcedFrom) {
    const piece = boardState[forcedFrom.r] && boardState[forcedFrom.r][forcedFrom.c];
    if (!piece || ownerOf(piece) !== player) {
      return [];
    }
    return generateCaptureMovesForPiece(boardState, forcedFrom.r, forcedFrom.c);
  }

  const captures = [];
  const simpleMoves = [];

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const piece = boardState[row][col];
      if (!piece || ownerOf(piece) !== player) {
        continue;
      }

      const pieceCaptures = generateCaptureMovesForPiece(boardState, row, col);
      if (pieceCaptures.length > 0) {
        captures.push(...pieceCaptures);
      } else {
        simpleMoves.push(...generateSimpleMovesForPiece(boardState, row, col));
      }
    }
  }

  return captures.length > 0 ? captures : simpleMoves;
}

function generateSimpleMovesForPiece(boardState, row, col) {
  const piece = boardState[row][col];
  const dirs = getMoveDirections(piece);
  const moves = [];

  for (const [dr, dc] of dirs) {
    const nextRow = row + dr;
    const nextCol = col + dc;
    if (!isInsideBoard(nextRow, nextCol)) {
      continue;
    }
    if (boardState[nextRow][nextCol] !== EMPTY) {
      continue;
    }

    moves.push({
      from: { r: row, c: col },
      to: { r: nextRow, c: nextCol },
      isCapture: false,
      capture: null
    });
  }

  return moves;
}

function generateCaptureMovesForPiece(boardState, row, col) {
  const piece = boardState[row][col];
  const player = ownerOf(piece);
  if (!player) {
    return [];
  }

  const moves = [];
  for (const [dr, dc] of getCaptureDirections(piece)) {
    const middleRow = row + dr;
    const middleCol = col + dc;
    const landingRow = row + dr * 2;
    const landingCol = col + dc * 2;

    if (!isInsideBoard(middleRow, middleCol) || !isInsideBoard(landingRow, landingCol)) {
      continue;
    }

    const middlePiece = boardState[middleRow][middleCol];
    if (!middlePiece || ownerOf(middlePiece) === player) {
      continue;
    }
    if (boardState[landingRow][landingCol] !== EMPTY) {
      continue;
    }

    moves.push({
      from: { r: row, c: col },
      to: { r: landingRow, c: landingCol },
      isCapture: true,
      capture: { r: middleRow, c: middleCol }
    });
  }

  return moves;
}

function applyMove(boardState, move) {
  const movingPiece = boardState[move.from.r][move.from.c];
  boardState[move.from.r][move.from.c] = EMPTY;
  boardState[move.to.r][move.to.c] = movingPiece;

  if (move.capture) {
    boardState[move.capture.r][move.capture.c] = EMPTY;
    halfMoveClock = 0;
  } else {
    halfMoveClock += 1;
  }

  if (movingPiece === HUMAN_MAN && move.to.r === 0) {
    boardState[move.to.r][move.to.c] = HUMAN_KING;
  } else if (movingPiece === AI_MAN && move.to.r === BOARD_SIZE - 1) {
    boardState[move.to.r][move.to.c] = AI_KING;
  }
}

function pickAiMove(stateKey, moves) {
  if (Math.random() < rl.epsilon) {
    const randomMove = moves[Math.floor(Math.random() * moves.length)];
    return { move: randomMove, actionKey: toActionKey(randomMove) };
  }

  let bestValue = -Infinity;
  const best = [];

  for (const move of moves) {
    const actionKey = toActionKey(move);
    const value = getQValue(stateKey, actionKey);
    if (value > bestValue + 1e-9) {
      bestValue = value;
      best.length = 0;
      best.push({ move, actionKey });
    } else if (Math.abs(value - bestValue) < 1e-9) {
      best.push({ move, actionKey });
    }
  }

  if (best.length === 0) {
    const fallback = moves[Math.floor(Math.random() * moves.length)];
    return { move: fallback, actionKey: toActionKey(fallback) };
  }

  return best[Math.floor(Math.random() * best.length)];
}

function serializeState(boardState, chainFrom) {
  const flat = boardState.flat().join("");
  const chainPart = chainFrom ? `${chainFrom.r}${chainFrom.c}` : "na";
  return `ai|${chainPart}|${flat}`;
}

function toActionKey(move) {
  const capturePart = move.capture ? `x${move.capture.r}${move.capture.c}` : "";
  return `${move.from.r}${move.from.c}-${move.to.r}${move.to.c}${capturePart}`;
}

function getQValue(stateKey, actionKey) {
  const stateRow = rl.q[stateKey];
  if (!stateRow) {
    return 0;
  }
  const value = stateRow[actionKey];
  return typeof value === "number" ? value : 0;
}

function setQValue(stateKey, actionKey, value) {
  if (!rl.q[stateKey]) {
    rl.q[stateKey] = {};
  }
  rl.q[stateKey][actionKey] = value;
}

function evaluateMaterial(boardState) {
  let score = 0;
  for (const row of boardState) {
    for (const piece of row) {
      if (piece === AI_MAN) {
        score += 1;
      } else if (piece === AI_KING) {
        score += 1.5;
      } else if (piece === HUMAN_MAN) {
        score -= 1;
      } else if (piece === HUMAN_KING) {
        score -= 1.5;
      }
    }
  }
  return score;
}

function getMoveDirections(piece) {
  if (piece === HUMAN_MAN) {
    return [
      [-1, -1],
      [-1, 1]
    ];
  }
  if (piece === AI_MAN) {
    return [
      [1, -1],
      [1, 1]
    ];
  }
  return DIAGONALS;
}

function getCaptureDirections(piece) {
  if (piece === HUMAN_MAN || piece === AI_MAN) {
    return DIAGONALS;
  }
  return DIAGONALS;
}

function isDarkSquare(row, col) {
  return (row + col) % 2 === 1;
}

function isInsideBoard(row, col) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function ownerOf(piece) {
  if (isHumanPiece(piece)) {
    return "human";
  }
  if (isAiPiece(piece)) {
    return "ai";
  }
  return null;
}

function isHumanPiece(piece) {
  return piece === HUMAN_MAN || piece === HUMAN_KING;
}

function isAiPiece(piece) {
  return piece === AI_MAN || piece === AI_KING;
}

function render() {
  renderBoard();
  statusTextEl.textContent = statusMessage;

  prideWinsEl.textContent = String(stats.humanWins);
  aiWinsEl.textContent = String(stats.aiWins);
  drawsEl.textContent = String(stats.draws);
  bestStreakEl.textContent = String(stats.bestStreak);
  gamesPlayedEl.textContent = String(stats.games);
  currentStreakEl.textContent = String(stats.currentStreak);
  epsilonValueEl.textContent = `${Math.round(rl.epsilon * 100)}%`;
  stateCountEl.textContent = String(Object.keys(rl.q).length);
}

function renderBoard() {
  const movableOrigins = new Set();
  for (const move of legalMoves) {
    movableOrigins.add(cellKey(move.from.r, move.from.c));
  }

  const targetCells = new Set();
  if (selectedCell) {
    for (const move of legalMoves) {
      if (move.from.r === selectedCell.r && move.from.c === selectedCell.c) {
        targetCells.add(cellKey(move.to.r, move.to.c));
      }
    }
  }

  boardEl.innerHTML = "";

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = `cell ${isDarkSquare(row, col) ? "dark" : "light"}`;
      cell.dataset.r = String(row);
      cell.dataset.c = String(col);

      const key = cellKey(row, col);
      if (!gameOver && turn === "human" && movableOrigins.has(key)) {
        cell.classList.add("movable");
      }
      if (selectedCell && selectedCell.r === row && selectedCell.c === col) {
        cell.classList.add("selected");
      }
      if (targetCells.has(key)) {
        cell.classList.add("target");
      }

      const piece = board[row][col];
      if (piece !== EMPTY) {
        const pieceEl = document.createElement("span");
        pieceEl.classList.add("piece");
        if (isHumanPiece(piece)) {
          pieceEl.classList.add("human");
        } else {
          pieceEl.classList.add("ai");
        }
        if (piece === HUMAN_KING || piece === AI_KING) {
          pieceEl.classList.add("king");
        }
        cell.appendChild(pieceEl);
      }

      boardEl.appendChild(cell);
    }
  }
}

function cellKey(row, col) {
  return `${row},${col}`;
}

function saveStats() {
  try {
    localStorage.setItem(STORAGE_KEYS.stats, JSON.stringify(stats));
  } catch (_error) {
    // Ignore storage issues and keep the game playable.
  }
}

function saveRl() {
  try {
    localStorage.setItem(STORAGE_KEYS.rl, JSON.stringify(rl));
  } catch (_error) {
    // Ignore storage issues and keep the game playable.
  }
}

function loadStats() {
  const parsed = loadFromStorage(STORAGE_KEYS.stats);
  if (!parsed || typeof parsed !== "object") {
    return makeDefaultStats();
  }

  const defaults = makeDefaultStats();
  return {
    humanWins: toNumber(parsed.humanWins, defaults.humanWins),
    aiWins: toNumber(parsed.aiWins, defaults.aiWins),
    draws: toNumber(parsed.draws, defaults.draws),
    games: toNumber(parsed.games, defaults.games),
    currentStreak: toNumber(parsed.currentStreak, defaults.currentStreak),
    bestStreak: toNumber(parsed.bestStreak, defaults.bestStreak)
  };
}

function loadRl() {
  const parsed = loadFromStorage(STORAGE_KEYS.rl);
  const defaults = makeDefaultRl();

  if (!parsed || typeof parsed !== "object") {
    return defaults;
  }

  return {
    alpha: clamp(toNumber(parsed.alpha, defaults.alpha), 0.01, 1),
    gamma: clamp(toNumber(parsed.gamma, defaults.gamma), 0.1, 0.999),
    epsilon: clamp(toNumber(parsed.epsilon, defaults.epsilon), 0, 1),
    minEpsilon: clamp(toNumber(parsed.minEpsilon, defaults.minEpsilon), 0, 0.5),
    epsilonDecay: clamp(toNumber(parsed.epsilonDecay, defaults.epsilonDecay), 0.8, 0.9999),
    games: toNumber(parsed.games, defaults.games),
    q: parsed.q && typeof parsed.q === "object" ? parsed.q : {}
  };
}

function loadFromStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function toNumber(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
