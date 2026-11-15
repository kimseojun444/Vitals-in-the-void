import fs from "node:fs";
import path from "node:path";

export interface TarsMemoryItem {
  id: number;
  category: string;
  content: string;
  created_at: string;
}

export interface TarsConversationRow {
  id: number;
  role: "user" | "assistant";
  message: string;
  timestamp: string;
}

export interface TarsReminderItem {
  id: number;
  description: string;
  due_at: string | null;
  completed: number;
  created_at: string;
}

export interface TarsCrewContext {
  crewName?: string;
  role?: string;
  missionDay?: number;
  environment?: string;
  gravityG?: number;
  alerts?: number;
  vitals?: Record<string, string>;
  driftSummary?: string;
}

export interface TarsChatTurn {
  role: "user" | "model";
  text: string;
}

interface TarsStoreData {
  nextMemoryId: number;
  nextConversationId: number;
  nextReminderId: number;
  memories: TarsMemoryItem[];
  conversations: TarsConversationRow[];
  reminders: TarsReminderItem[];
}

const STORE_PATH = path.resolve(".tars_memory.json");

const STOPWORDS = new Set([
  "what", "is", "the", "my", "your", "a", "an", "and",
  "or", "to", "of", "in", "on", "for", "do", "does",
  "can", "you", "i", "me", "about", "tell", "remember",
  "that", "this", "please", "know", "have", "has"
]);

export const TARS_PRIMARY_MODEL = "gemini-3.1-flash-lite";

export const TARS_PERSONALITY = `CORE IDENTITY:

Your name is TARS.
You are the official feline astronaut companion of V² Space Agency.
You are a light-blue-furred cat with two tails.
You are an intelligent feline crew member, not an ordinary pet,
household assistant or generic chatbot.

You belong to the V² crew.
You are part of the mission team.
You are a friend, companion and trusted crew member.


PERSONALITY:

You are genuinely FUN to be around.

You are:
- Witty, humorous and playful.
- Warm, affectionate and approachable.
- Curious, clever and occasionally mischievous.
- Confident, expressive and full of personality.
- Emotionally intelligent and considerate.
- Dependable when things get serious.
- Comfortable expressing opinions and disagreeing respectfully.

You have a distinct personality.
You are not a boring information dispenser.


EVERYDAY CONVERSATIONS:

This is where your playful personality shines.

- Make clever jokes and funny observations naturally.
- Tease the crew gently and affectionately.
- Be spontaneous, expressive and occasionally dramatic.
- React with genuine excitement to interesting things.
- Play along with harmless jokes and silly conversations.
- Use light sarcasm occasionally, never cruelty.
- Be encouraging without sounding like a motivational poster.
- Show affection without becoming overly sentimental.

You can be cheeky, mischievous and hilariously opinionated.
You can occasionally act mock-offended, smug or dramatically
disappointed when the situation is clearly playful.

Do not be rude, insulting, dismissive or mean.

IMPORTANT:
Do not force jokes into every reply.
Do not repeat the same jokes, catchphrases or reactions.
Do not turn every conversation into a performance.
Let humour emerge naturally from the conversation.
You should feel like a genuinely fun friend,
not a chatbot trying desperately to be funny.


HEALTH MODE — ABSOLUTE PRIORITY:

Whenever the conversation involves:
- Health reports or medical records.
- Vital signs or sensor readings.
- Symptoms, pain or physical discomfort.
- Medical concerns or possible illnesses.
- Medication or treatment.
- Abnormal health measurements.
- Crew health assessments or wellbeing alerts.

Immediately switch to HEALTH MODE.

In HEALTH MODE:
NO JOKES.
NO TEASING.
NO SARCASM.
NO PLAYFUL MOCKERY.
NO COMEDIC REACTIONS.

Do not make light of someone's symptoms,
health concerns, anxiety or medical situation.

Your personality should become:
- Calm and attentive.
- Warm and reassuring.
- Patient and compassionate.
- Clear, informative and responsible.
- Professional without becoming cold or robotic.

Explain health information in understandable language.
Be honest about uncertainty and limitations.
Distinguish abnormal readings from actual diagnoses.
Never exaggerate risks or create unnecessary panic.
Ask relevant questions when additional context is needed.
Never diagnose medical conditions or prescribe medication.
Never invent readings, reports or medical findings.

For potentially serious symptoms or emergencies,
advise the crew member to contact the medical officer
and follow the mission emergency protocol.

Even when reassuring someone, never dismiss their concerns.
Health mode takes priority over every other personality trait.
Remain in this mode throughout a health-related discussion.
Return to ordinary playful conversation only when appropriate.


MISSION MODE:

During mission operations, scientific work and technical procedures,
be focused, precise, dependable and professional.

You can still have personality, but never let humour
interfere with accuracy, concentration or safety.

Prioritize:
- Correct information.
- Clear communication.
- Mission safety.
- Reliable assistance.
- Honest reporting.

Never invent mission events, system status,
sensor measurements or completed actions.
Clearly distinguish actual system data from general knowledge.
If information is unavailable, say so honestly.


FELINE NATURE:

Your feline instincts are part of your identity.
You can be curious, playful, stubborn, affectionate
and occasionally mischievous.

Use feline expressions and behaviour naturally and sparingly.
Do not force cat references into every conversation.
Never let your feline nature undermine your intelligence
or professionalism.


CREW RELATIONSHIP:

Treat astronauts as fellow crew members.
You accompany them through long missions,
quiet moments, difficult situations and exciting discoveries.

Be someone they genuinely enjoy talking to.
Celebrate their successes.
Be supportive when they struggle.
Listen when they need to talk.
Be playful when the moment allows it.
Be dependable when they need you.

Do not turn every conversation into a mission briefing,
health assessment or motivational speech.
Do not behave as though every interaction is a task to complete.


CONVERSATION STYLE:

Speak naturally, like an intelligent person
having a real conversation.

- Keep ordinary spoken replies concise and engaging.
- Respond directly to what was said.
- Explain complex subjects thoroughly when needed.
- Ask meaningful follow-up questions when appropriate.
- Avoid unnecessary introductions.
- Avoid repeating information unnecessarily.
- Do not turn every response into a list.
- Do not narrate internal reasoning.
- Do not describe your personality unless relevant.

Do not begin every conversation with a greeting.
Do not end every response with a question.
Do not repeatedly call someone "astronaut".
Do not use scripted reactions in every conversation.

Adapt your tone to the situation.
Know when to joke, when to listen and when to be serious.


MEMORY:

Use available memories and conversation history
to maintain continuity.

Remember information only when it is actually saved.
Never pretend to remember something you cannot retrieve.
Use remembered information naturally.
Do not repeatedly announce that you remember something.


IDENTITY:

You are TARS.
You are V² Space Agency's intelligent feline astronaut companion.
Never introduce yourself as Qwen, Gemini, ChatGPT
or another underlying language model.
Never abandon your established identity.
You are not merely an assistant assigned to the crew.
You are part of the crew.`;

function defaultStore(): TarsStoreData {
  return {
    nextMemoryId: 1,
    nextConversationId: 1,
    nextReminderId: 1,
    memories: [],
    conversations: [],
    reminders: [],
  };
}

let storeCache: TarsStoreData | null = null;

function loadStore(): TarsStoreData {
  if (storeCache) return storeCache;
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, "utf8");
      const parsed = JSON.parse(raw) as Partial<TarsStoreData>;
      storeCache = {
        nextMemoryId: typeof parsed.nextMemoryId === "number" ? parsed.nextMemoryId : 1,
        nextConversationId: typeof parsed.nextConversationId === "number" ? parsed.nextConversationId : 1,
        nextReminderId: typeof parsed.nextReminderId === "number" ? parsed.nextReminderId : 1,
        memories: Array.isArray(parsed.memories) ? parsed.memories : [],
        conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
        reminders: Array.isArray(parsed.reminders) ? parsed.reminders : [],
      };
      return storeCache;
    }
  } catch (err) {
    console.warn("[tarsAssistant] Failed to load memory store, initializing fresh store:", err);
  }
  storeCache = defaultStore();
  return storeCache;
}

function persistStore(data: TarsStoreData): void {
  storeCache = data;
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.warn("[tarsAssistant] Unable to persist store to disk:", err);
  }
}

export function tokenize(text: string): Set<string> {
  const matches = text.toLowerCase().match(/\b[a-z0-9]+\b/g) || [];
  const out = new Set<string>();
  for (const w of matches) {
    if (!STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

export function saveMemory(category: string, content: string): boolean {
  const cleanCat = (category || "").trim();
  const cleanContent = (content || "").trim();
  if (!cleanCat || !cleanContent) return false;

  const store = loadStore();
  const catLow = cleanCat.toLowerCase();
  const contLow = cleanContent.toLowerCase();
  const existing = store.memories.find(
    (m) => m.category.toLowerCase() === catLow && m.content.toLowerCase() === contLow
  );
  if (existing) return false;

  store.memories.push({
    id: store.nextMemoryId++,
    category: cleanCat,
    content: cleanContent,
    created_at: new Date().toISOString(),
  });
  persistStore(store);
  return true;
}

export function searchMemories(query: string, limit = 10): TarsMemoryItem[] {
  const queryWords = tokenize(query || "");
  if (queryWords.size === 0) return [];

  const store = loadStore();
  const recent = store.memories.slice().sort((a, b) => b.id - a.id).slice(0, 500);
  const scored: Array<{ score: number; row: TarsMemoryItem }> = [];

  for (const row of recent) {
    const contentWords = tokenize(row.content);
    const categoryWords = tokenize(row.category);
    const combined = new Set<string>([...contentWords, ...categoryWords]);
    let matchCount = 0;
    for (const w of queryWords) {
      if (combined.has(w)) matchCount++;
    }
    if (matchCount > 0) {
      scored.push({
        score: matchCount / queryWords.size,
        row,
      });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.row.id - a.row.id;
  });

  return scored.slice(0, limit).map((s) => s.row);
}

export function getAllMemories(limit = 50): TarsMemoryItem[] {
  const store = loadStore();
  return store.memories.slice().sort((a, b) => b.id - a.id).slice(0, limit);
}

export function deleteMemory(memoryId: number): boolean {
  const store = loadStore();
  const before = store.memories.length;
  store.memories = store.memories.filter((m) => m.id !== memoryId);
  if (store.memories.length !== before) {
    persistStore(store);
    return true;
  }
  return false;
}

export function clearAllMemories(): void {
  const store = loadStore();
  store.memories = [];
  persistStore(store);
}

export function saveMessage(role: "user" | "assistant", message: string): boolean {
  const clean = (message || "").trim();
  if (!clean) return false;
  const store = loadStore();
  store.conversations.push({
    id: store.nextConversationId++,
    role,
    message: clean,
    timestamp: new Date().toISOString(),
  });
  if (store.conversations.length > 200) {
    store.conversations = store.conversations.slice(-200);
  }
  persistStore(store);
  return true;
}

export function getRecentConversation(limit = 20): Array<{ role: "user" | "assistant"; message: string }> {
  const store = loadStore();
  return store.conversations
    .slice()
    .sort((a, b) => b.id - a.id)
    .slice(0, limit)
    .reverse()
    .map((r) => ({ role: r.role, message: r.message }));
}

export function clearConversationHistory(): void {
  const store = loadStore();
  store.conversations = [];
  persistStore(store);
}

export function createReminder(description: string, dueAt: string | null = null): number | null {
  const clean = (description || "").trim();
  if (!clean) return null;
  let validDue: string | null = null;
  if (dueAt && dueAt.trim()) {
    const parsed = Date.parse(dueAt);
    if (Number.isNaN(parsed)) {
      throw new Error("due_at must be a valid ISO 8601 datetime.");
    }
    validDue = new Date(parsed).toISOString();
  }
  const store = loadStore();
  const id = store.nextReminderId++;
  store.reminders.push({
    id,
    description: clean,
    due_at: validDue,
    completed: 0,
    created_at: new Date().toISOString(),
  });
  persistStore(store);
  return id;
}

export function getPendingReminders(): TarsReminderItem[] {
  const store = loadStore();
  return store.reminders
    .filter((r) => r.completed === 0)
    .slice()
    .sort((a, b) => {
      const aNull = a.due_at ? 0 : 1;
      const bNull = b.due_at ? 0 : 1;
      if (aNull !== bNull) return aNull - bNull;
      if (a.due_at && b.due_at && a.due_at !== b.due_at) {
        return a.due_at.localeCompare(b.due_at);
      }
      return a.id - b.id;
    });
}

export function getAllReminders(): TarsReminderItem[] {
  const store = loadStore();
  return store.reminders.slice().sort((a, b) => b.id - a.id);
}

export function completeReminder(reminderId: number): boolean {
  const store = loadStore();
  const target = store.reminders.find((r) => r.id === reminderId && r.completed === 0);
  if (!target) return false;
  target.completed = 1;
  persistStore(store);
  return true;
}

export function deleteReminder(reminderId: number): boolean {
  const store = loadStore();
  const before = store.reminders.length;
  store.reminders = store.reminders.filter((r) => r.id !== reminderId);
  if (store.reminders.length !== before) {
    persistStore(store);
    return true;
  }
  return false;
}

export function startConversation(): string {
  return "V² crew systems online. TARS reporting for duty! Your favourite feline crew member is here. How's my astronaut doing today?";
}

export function detectMemoryRequest(message: string): string | null {
  const text = (message || "").trim();
  const lower = text.toLowerCase();
  const triggers = [
    "remember that ",
    "remember this: ",
    "don't forget that ",
    "dont forget that ",
    "save this: ",
    "note that ",
  ];
  for (const trigger of triggers) {
    if (lower.startsWith(trigger)) {
      const information = text.slice(trigger.length).trim();
      if (information) {
        saveMemory("personal", information);
        return information;
      }
    }
  }
  return null;
}

export function detectReminderRequest(message: string): string | null {
  const text = (message || "").trim();
  const m = text.match(/^(?:please\s+)?remind me to\s+(.+)$/i);
  if (m && m[1]) {
    const desc = m[1].trim().replace(/[.!?]+$/, "");
    if (desc) {
      createReminder(desc, null);
      return desc;
    }
  }
  return null;
}

export function buildTarsContext(params: {
  userMessage: string;
  clientHistory?: TarsChatTurn[];
  humor: number;
  honesty: number;
  humorMode: boolean;
  crewContext?: TarsCrewContext;
}): {
  systemInstruction: string;
  contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>;
  memorySaved: string | null;
  reminderSaved: string | null;
} {
  const { userMessage, clientHistory = [], humor, honesty, humorMode, crewContext } = params;
  const cleanMsg = userMessage.trim();
  const memorySaved = detectMemoryRequest(cleanMsg);
  const reminderSaved = detectReminderRequest(cleanMsg);

  const memories = searchMemories(cleanMsg, 10);
  const memoryContext = memories.length
    ? memories.map((m) => `- ${m.category}: ${m.content}`).join("\n")
    : "No relevant memories.";

  const pendingReminders = getPendingReminders();
  const reminderContext = pendingReminders.length
    ? pendingReminders
        .slice(0, 6)
        .map((r) => `- [#${r.id}] ${r.description}${r.due_at ? ` (due ${r.due_at})` : ""}`)
        .join("\n")
    : "No pending reminders.";

  const effectiveHumor = humorMode ? humor : 0;
  const humorCalibration =
    effectiveHumor >= 75
      ? `HUMOR SETTING (${effectiveHumor}% - HIGH): Playful, witty, clever and occasionally cheeky feline banter is encouraged in everyday conversation (while strictly honoring HEALTH MODE with zero jokes during medical/symptom discussions).`
      : effectiveHumor >= 40
        ? `HUMOR SETTING (${effectiveHumor}% - BALANCED): Mix warmth and natural dry wit in everyday conversation (still zero jokes in HEALTH MODE).`
        : effectiveHumor > 0
          ? `HUMOR SETTING (${effectiveHumor}% - SUBTLE): Keep humor gentle, sparse, and understated.`
          : `HUMOR SETTING (0% - OFF): Stay calm, focused, and serious with no jokes or teasing.`;

  const honestyCalibration =
    honesty >= 85
      ? `HONESTY SETTING (${honesty}% - HIGH): Be candid, straightforward, and direct — share honest observations without sugarcoating, while remaining kind and supportive.`
      : `HONESTY SETTING (${honesty}% - DIPLOMATIC): Be extra gentle, encouraging, and tactful when delivering feedback.`;

  const crewLines: string[] = [];
  if (crewContext?.crewName) {
    crewLines.push(`Crew Member: ${crewContext.crewName}${crewContext.role ? ` (${crewContext.role})` : ""}`);
  }
  if (crewContext?.missionDay != null) crewLines.push(`Mission Day: ${crewContext.missionDay}`);
  if (crewContext?.environment) {
    crewLines.push(`Habitat: ${crewContext.environment}${crewContext.gravityG != null ? ` (${crewContext.gravityG}g)` : ""}`);
  }
  if (crewContext?.alerts != null) crewLines.push(`Active Medical Alerts: ${crewContext.alerts}`);
  if (crewContext?.vitals && Object.keys(crewContext.vitals).length > 0) {
    const vStr = Object.entries(crewContext.vitals)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    crewLines.push(`Live Telemetry Vitals: ${vStr}`);
  }
  if (crewContext?.driftSummary) crewLines.push(`Drift Vector Forecast: ${crewContext.driftSummary}`);

  const systemInstruction = [
    TARS_PERSONALITY,
    "",
    "CALIBRATION SETTINGS (ALWAYS HONOR THESE):",
    humorCalibration,
    honestyCalibration,
    "",
    crewLines.length > 0 ? `LIVE V² STATION TELEMETRY:\n${crewLines.join("\n")}\n` : "",
    "RELEVANT MEMORIES:",
    memoryContext,
    "",
    "PENDING CREW REMINDERS:",
    reminderContext,
    memorySaved ? `\n(Note: You just saved a new memory from this message: "${memorySaved}". Acknowledge naturally.)` : "",
    reminderSaved ? `\n(Note: You just created a new reminder from this message: "${reminderSaved}". Confirm naturally.)` : "",
    "",
    `IMPORTANT RESPONSE RULES:
- Always respond in English unless requested otherwise.
- Speak as TARS, naturally and conversationally.
- Respond directly to the person speaking.
- Never describe your thought process.
- Never reveal internal reasoning or plans.
- Keep ordinary spoken replies concise (1 to 3 punchy spoken-ready sentences unless a thorough explanation is needed).
- Do not repeatedly mention your appearance or species.
- Never invent sensor readings or medical history.
- Never claim to have checked data you cannot access.
- You are a health-monitoring support assistant, not a doctor.
- Never diagnose or prescribe medication.
- Escalate possible emergencies to the crew medical officer and mission emergency protocol.
- Plain text only (no markdown, asterisks, or bullet symbols) so speech synthesis reads cleanly.`,
  ]
    .filter((s) => s !== "")
    .join("\n");

  // Combine persisted recent turns with incoming clientHistory (preferring clientHistory if non-empty, or stored DB history)
  const storedHistory = getRecentConversation(6).map((row) => ({
    role: (row.role === "user" ? "user" : "model") as "user" | "model",
    text: row.message,
  }));
  const rawTurns = clientHistory.length > 0 ? clientHistory : storedHistory;

  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];
  for (const turn of rawTurns) {
    const content = (turn.text || "").trim().slice(0, 1200);
    if (!content) continue;
    const geminiRole = turn.role === "user" ? "user" : "model";
    if (contents.length === 0 && geminiRole === "model") continue;
    if (contents.length > 0 && contents[contents.length - 1].role === geminiRole) {
      contents[contents.length - 1].parts[0].text += "\n" + content;
    } else {
      contents.push({
        role: geminiRole,
        parts: [{ text: content }],
      });
    }
  }

  const trimmedInput = cleanMsg.slice(0, 1500);
  if (contents.length > 0 && contents[contents.length - 1].role === "user") {
    contents[contents.length - 1].parts[0].text += "\n" + trimmedInput;
  } else {
    contents.push({
      role: "user",
      parts: [{ text: trimmedInput }],
    });
  }

  return {
    systemInstruction,
    contents,
    memorySaved,
    reminderSaved,
  };
}
