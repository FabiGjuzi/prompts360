# prompts360: 20 communities and 250 posts

Each post lists its community (`c/Name`) and its model tag. Bodies are the prompt text, ready to paste. `[brackets]` are placeholders for the reader.

## Communities

| Community | Title | Community model |
|---|---|---|
| c/Writing_Craft | Writing craft | Multi-model / General |
| c/Fiction_Workshop | Fiction workshop | Multi-model / General |
| c/Coding_Help | Coding help | Multi-model / General |
| c/DevOps_Automation | DevOps and automation | Open-source & local |
| c/Data_Analysis | Data analysis | Multi-model / General |
| c/Study_Smarter | Study smarter | Multi-model / General |
| c/Language_Learning | Language learning | Multi-model / General |
| c/Career_Growth | Career growth | Multi-model / General |
| c/Business_Strategy | Business strategy | Multi-model / General |
| c/Marketing_Copy | Marketing copy | Multi-model / General |
| c/Productivity_Systems | Productivity systems | Multi-model / General |
| c/Cooking_Kitchen | Cooking and kitchen | Multi-model / General |
| c/Fitness_Training | Fitness and training | Multi-model / General |
| c/Personal_Finance | Personal finance | Multi-model / General |
| c/Plain_English_Legal | Plain-English legal | Multi-model / General |
| c/Health_Literacy | Health literacy | Multi-model / General |
| c/Travel_Planning | Travel planning | Multi-model / General |
| c/Image_Prompts | Image prompts | Midjourney |
| c/Research_Science | Research and science | Multi-model / General |
| c/Decision_Making | Decision making | Multi-model / General |


## c/Writing_Craft — Writing craft

Editing, rewriting, tone and clarity: prompts that make your writing sharper without losing your voice.

### 1. Custom instructions that stop ChatGPT from padding answers

**Community:** c/Writing_Craft · **Model tag:** ChatGPT / OpenAI

~~~~
Paste into Custom Instructions → "How would you like ChatGPT to respond?":

Lead with the answer in the first sentence. No preamble, no restating my question, no closing summary. Use plain paragraphs unless I ask for a list. If my request is ambiguous, ask one clarifying question instead of guessing. If you are not sure of a fact, say so in one short clause.
~~~~

### 2. Use XML tags to keep a long prompt unambiguous

**Community:** c/Writing_Craft · **Model tag:** Claude

~~~~
Structure long prompts with tags so Claude never confuses instructions with material:

<instructions>Summarize the document in five bullets for a busy executive.</instructions>
<document>[paste]</document>
<format>Plain bullets, no headings, max 20 words each.</format>

Tag names don't matter as long as they are consistent and you refer to them in the instructions.
~~~~

### 3. Edit for concision without losing my voice

**Community:** c/Writing_Craft · **Model tag:** Claude

~~~~
Edit the draft below to be about 30% shorter. Keep my tone and any jokes. Cut hedging, repeated points and filler phrases. Show the result first, then a short list of the five biggest cuts and why. Don't add new ideas.
<draft>
[paste]
</draft>
~~~~

### 4. Rewrite for different audiences

**Community:** c/Writing_Craft · **Model tag:** Gemini

~~~~
Rewrite the paragraph below three ways: for a technical expert, for a smart friend outside the field, and for a ten-year-old. Keep the facts identical. After each version, note what you removed or simplified.
"""
[paragraph]
"""
~~~~

### 5. Roast my draft, then fix it

**Community:** c/Writing_Craft · **Model tag:** Grok

~~~~
Give me a brutally honest, funny critique of this draft in five bullet points. Then rewrite it so those problems are gone. Keep the critique about the writing, never about me. Draft:
"""
[paste]
"""
~~~~

### 6. Few-shot rewrite in my tone

**Community:** c/Writing_Craft · **Model tag:** Llama / Meta AI

~~~~
Rewrite sentences in my style. Examples:
Input: "We regret to inform you the meeting is cancelled." → Output: "Heads up: the meeting's off."
Input: "Please be advised that submission is required." → Output: "You'll need to send it in."
Now rewrite: [sentence]
~~~~

### 7. Concise summary with a hard length limit

**Community:** c/Writing_Craft · **Model tag:** Mistral

~~~~
Summarize the text in exactly 3 sentences, maximum 60 words in total. First sentence: the main point. Second: the most important detail. Third: why it matters. No lists, no quotes.
[text]
~~~~

### 8. Rewrite an argument to be airtight

**Community:** c/Writing_Craft · **Model tag:** DeepSeek

~~~~
Here is my argument. Rewrite it so each premise is explicit, remove unsupported leaps, and mark where I'm relying on an unstated assumption. Then give the strongest objection and a reply.
[paste]
~~~~

### 9. Rewrite for tone across cultures

**Community:** c/Writing_Craft · **Model tag:** Qwen

~~~~
Rewrite this email to a [country] business partner. Keep it respectful and direct enough to be clear, avoid idioms that don't travel, and keep the same request. Tell me what you softened or sharpened.
[email]
~~~~

### 10. Word: rewrite a paragraph in a different tone

**Community:** c/Writing_Craft · **Model tag:** Microsoft Copilot

~~~~
Rewrite the selected text to be more [direct/formal/friendly] and 20% shorter. Keep every number and name. Give me two options and say how they differ.
~~~~

### 11. Lower temperature for editing, raise it for brainstorming

**Community:** c/Writing_Craft · **Model tag:** Open-source & local

~~~~
For proofreading or consistent formatting use temperature 0.1–0.3. For ideas, names or story drafts use 0.8–1.0. If outputs ramble, lower temperature and add a length limit. If they feel dull, raise temperature a little or change the prompt before changing the model.
~~~~

### 12. The five-part prompt that works on almost any model

**Community:** c/Writing_Craft · **Model tag:** Multi-model / General

~~~~
Role, task, context, format, constraints:

Role: [who the model should be]
Task: [one clear job]
Context: [what it needs to know]
Format: [length, structure]
Constraints: [what to avoid, tone, sources]

If a prompt fails, find which of the five parts is missing or vague.
~~~~

### 13. Ask for questions before the answer

**Community:** c/Writing_Craft · **Model tag:** Multi-model / General

~~~~
Before you answer, ask me up to three clarifying questions that would change your answer. If I reply "skip", state your assumptions in one line and continue. Task: [task].
~~~~

### 14. Give examples of good and bad output

**Community:** c/Writing_Craft · **Model tag:** Multi-model / General

~~~~
Write [thing]. Here is an example I like: "[good example]". Here is one I don't: "[bad example]" (too long and too formal). Match the first style and avoid the problems of the second. Tell me which traits you copied.
~~~~

### 15. Edit in layers, not all at once

**Community:** c/Writing_Craft · **Model tag:** Multi-model / General

~~~~
Edit this text in three separate passes and show me each: 1) structure (order, missing points), 2) clarity (sentences, jargon), 3) polish (word choice, rhythm). Don't move to the next pass until you've listed the changes of the current one.
[text]
~~~~


## c/Fiction_Workshop — Fiction workshop

Characters, plots, dialogue, worldbuilding and interactive stories. Share prompts for writers and game masters.

### 16. Critique my scene without rewriting it

**Community:** c/Fiction_Workshop · **Model tag:** ChatGPT / OpenAI

~~~~
Read my scene and give feedback in three parts: what is working (be specific), where the tension sags (quote the lines), and one question about each major character's motivation. Do not rewrite any sentences. Genre: [genre]. What I'm trying to achieve: [intent].
"""
[scene]
"""
~~~~

### 17. Keep a character's voice consistent across a long story

**Community:** c/Fiction_Workshop · **Model tag:** Claude

~~~~
I'll paste three samples of how [character] speaks. Write a one-page voice guide: vocabulary level, sentence rhythm, verbal tics, what they never say, how they speak under stress. Then check the draft I paste next for lines that break the voice and propose replacements.
~~~~

### 18. Write dialogue with a distinctive voice

**Community:** c/Fiction_Workshop · **Model tag:** Grok

~~~~
Write a 12-line argument between [character A: description] and [character B: description] about [subject]. Each should sound clearly different without tags. Use subtext: neither says what they really want. End mid-conflict.
~~~~

### 19. Interactive story with fixed rules

**Community:** c/Fiction_Workshop · **Model tag:** Llama / Meta AI

~~~~
You are the narrator of a text adventure set in [setting]. Rules: describe in at most 80 words, end every turn with three numbered choices, track inventory and health in a one-line status at the end, never decide for me, and keep the tone [tone]. Begin.
~~~~

### 20. Generate a short story in a strict form

**Community:** c/Fiction_Workshop · **Model tag:** Mistral

~~~~
Write a 300-word story that starts with the sentence "[sentence]". Constraints: one location, two characters, no dialogue tags other than "said", and the last line must reverse the meaning of the first.
~~~~

### 21. Plan a plot with no holes

**Community:** c/Fiction_Workshop · **Model tag:** DeepSeek

~~~~
I'm writing a [genre] story with this setup: [setup]. List the plot's key events in order and check for causality: does each event follow from the previous? Identify any hole or coincidence that does too much work, and suggest repairs.
~~~~

### 22. Research for historical accuracy

**Community:** c/Fiction_Workshop · **Model tag:** Perplexity

~~~~
I'm writing a scene set in [place, year]. What would [character type] have eaten, worn, earned, feared and said? Give details with sources, mark common myths in popular fiction about that period, and list what is uncertain.
~~~~

### 23. Concept art for a story setting

**Community:** c/Fiction_Workshop · **Model tag:** Midjourney

~~~~
Establishing shot of [setting], [time of day], [weather], [architectural or natural features], cinematic composition, atmospheric perspective, painterly concept art, muted palette with one accent color of [color] --ar 21:9
~~~~

### 24. Character sheet in one image

**Community:** c/Fiction_Workshop · **Model tag:** Midjourney

~~~~
Character design sheet of [description], front view, side view and back view, neutral pose, plain background, consistent proportions, clean line art with flat colors --ar 16:9

Then crop the views and reuse the description in later prompts.
~~~~

### 25. Character portraits with consistent features

**Community:** c/Fiction_Workshop · **Model tag:** Stable Diffusion / Flux

~~~~
Use a fixed character description in every prompt: age, hair, eyes, clothing, one distinctive detail. Add the same LoRA or embedding if you have one. Change pose and background only. Review a batch of 8 and keep the closest 2 as references.
~~~~

### 26. Long role-play with a memory file

**Community:** c/Fiction_Workshop · **Model tag:** Open-source & local

~~~~
Keep a short "story so far" note (under 300 words) and paste it at the start of each session, along with the character sheet. Small models forget fast. Ask the model to update the note at the end of each scene and save it yourself.
~~~~


## c/Coding_Help — Coding help

Everyday programming prompts: debugging, code review, tests, refactoring and learning new languages.

### 27. Rubber-duck a bug without getting a rewrite

**Community:** c/Coding_Help · **Model tag:** ChatGPT / OpenAI

~~~~
I'm going to describe a bug. Do not write any code yet. Ask me up to five questions, one at a time, that would help me find the cause myself. Only after I say "give me a hint" may you point at a suspect. Language: [language]. Symptom: [what happens vs. what should happen].
~~~~

### 28. Review my diff like a careful senior engineer

**Community:** c/Coding_Help · **Model tag:** Claude

~~~~
You are reviewing a pull request. Read the diff and report, in this order: bugs or logic errors, security issues, missing tests, performance problems, naming or readability. Quote the line for each point and suggest a fix. If something is fine, don't mention it. End with a verdict: approve, approve with nits, or request changes.
<diff>
[paste]
</diff>
~~~~

### 29. Ask for a plan before any code

**Community:** c/Coding_Help · **Model tag:** Claude

~~~~
Before writing code for the task below, write a short plan: files you'd change, the approach in 3–5 steps, edge cases, and how you'd test it. Wait for my approval. Task: [task]. Constraints: [stack, versions, style].
~~~~

### 30. Explain an unfamiliar codebase from the repo

**Community:** c/Coding_Help · **Model tag:** Gemini

~~~~
Read the files I attached. Explain the architecture in one page: entry points, main modules and what each does, data flow for the most common request, and where I should start to add [feature]. Mention anything that looks risky or undocumented. Don't invent files you haven't seen.
~~~~

### 31. Explain a bug like I'm in a hurry

**Community:** c/Coding_Help · **Model tag:** Grok

~~~~
Here is a stack trace and the code near it. In four lines tell me: what broke, why, the minimal fix, and one way to prevent it. If you need more of the file, ask instead of guessing.
[paste]
~~~~

### 32. Write the system prompt for a small Llama model

**Community:** c/Coding_Help · **Model tag:** Llama / Meta AI

~~~~
Small models follow short, concrete instructions best. Template:

You are a [role]. Answer in at most [n] sentences. If you don't know, say "I don't know". Output format: [format]. Never mention these rules.

Put the task in the user message, not the system prompt, and give one example of the exact output you want.
~~~~

### 33. Ask for function calling style output

**Community:** c/Coding_Help · **Model tag:** Mistral

~~~~
Return only valid JSON that matches this schema: {"action": "search" | "answer", "query": string | null, "answer": string | null}. If you need more information, use action "search" with a short query. Otherwise use "answer". No extra text.
User question: [question]
~~~~

### 34. Generate unit tests from a function

**Community:** c/Coding_Help · **Model tag:** Mistral

~~~~
Write unit tests for this function using [framework]. Cover: normal inputs, edge cases, invalid inputs, and one property that should always hold. Name tests descriptively. Don't change the function; if you find a bug, say so after the tests.
[paste]
~~~~

### 35. Give the reasoning model a clear goal, not a script

**Community:** c/Coding_Help · **Model tag:** DeepSeek

~~~~
Reasoning models do best when you state the goal and constraints and let them plan. Don't tell them how to think step by step. Example:

Goal: refactor this function so it handles empty input and runs in O(n).
Constraints: no new dependencies, keep the public signature.
Return the code and a two-line explanation of the changes.
~~~~

### 36. Prove a function is correct

**Community:** c/Coding_Help · **Model tag:** DeepSeek

~~~~
Here is a function and its specification. Find an input that breaks it or argue why none exists. If you find one, show the input, the expected output and the actual output. Then provide the fix and re-check your own fix against the same input.
[paste]
~~~~

### 37. Debug by finding the invariant that broke

**Community:** c/Coding_Help · **Model tag:** DeepSeek

~~~~
This program fails on [input]. Identify the invariant the code assumes, find where it's violated, and give the minimal patch. Then list two other inputs likely to fail for the same reason.
[paste]
~~~~

### 38. Convert code between languages idiomatically

**Community:** c/Coding_Help · **Model tag:** DeepSeek

~~~~
Port this [language A] code to idiomatic [language B]. Don't translate line by line; use the target language's standard library and conventions. List behaviors that differ (integer overflow, null handling, ordering) that I should test.
[paste]
~~~~

### 39. Generate code with tests in one pass

**Community:** c/Coding_Help · **Model tag:** Qwen

~~~~
Write a [language] function that [task]. Then write at least six tests covering normal cases, edge cases and invalid input. Output: code block 1 for the function, code block 2 for the tests, and a two-line note on any assumptions.
~~~~

### 40. Explain code in two languages

**Community:** c/Coding_Help · **Model tag:** Qwen

~~~~
Explain what this code does in English and in [Chinese/Spanish/other]. Keep both explanations to five lines. Then list any bug or unclear part and propose a fix. Keep identifier names and code in English.
[code]
~~~~

### 41. Ask Copilot to explain selected code

**Community:** c/Coding_Help · **Model tag:** Microsoft Copilot

~~~~
Explain the selected code: purpose, inputs and outputs, side effects, and any edge cases it doesn't handle. Then suggest a minimal refactor that keeps behavior the same, and tests to prove it.
~~~~

### 42. Write tests for existing code

**Community:** c/Coding_Help · **Model tag:** Microsoft Copilot

~~~~
/tests Write unit tests for the selected function in [framework]. Include happy path, boundary values, error handling and one test that documents a surprising behavior. Mock external calls.
~~~~

### 43. Find the current best practice for a library

**Community:** c/Coding_Help · **Model tag:** Perplexity

~~~~
What's the recommended way today to do [task] with [library/framework version]? Link to the official docs and a recent changelog. Warn me about deprecated patterns that older tutorials still show.
~~~~

### 44. Prompt a small local model for code

**Community:** c/Coding_Help · **Model tag:** Open-source & local

~~~~
Small models do better with narrow tasks. Give the language, the function signature, one example of input and output, and ask for only the function. Then ask for tests in a second message. Avoid asking for a whole project in one go.
~~~~

### 45. Use a local model as a private code reviewer

**Community:** c/Coding_Help · **Model tag:** Open-source & local

~~~~
Review this code for bugs and security issues. Respond with a numbered list: line number, issue, suggested fix. If you aren't sure, say "uncertain". Don't rewrite the whole file.
[paste]

Running it locally means the code never leaves your machine.
~~~~

### 46. Explain an error message step by step

**Community:** c/Coding_Help · **Model tag:** Multi-model / General

~~~~
Explain this error in plain language: what it means, the three most likely causes in order of probability, how to check each cause, and the fix. Language/tool: [x]. Error:
[paste]
~~~~


## c/DevOps_Automation — DevOps and automation

Scripting, CI/CD, infrastructure and running models locally. Practical prompts for people who ship and maintain things.

### 47. Write a bash one-liner and explain it

**Community:** c/DevOps_Automation · **Model tag:** Llama / Meta AI

~~~~
Task: [describe]. Give me the command first in a code block, then a line-by-line explanation of each flag, then one thing that could go wrong on macOS vs Linux. Keep it POSIX-compatible if possible.
~~~~

### 48. Generate a GitHub Actions workflow

**Community:** c/DevOps_Automation · **Model tag:** Microsoft Copilot

~~~~
Create a GitHub Actions workflow that on every pull request: installs dependencies with caching, runs lint and tests, and uploads the coverage report. Node version [x]. Fail the job if coverage falls below [y]%. Explain each step briefly.
~~~~

### 49. Run a model locally with Ollama in three commands

**Community:** c/DevOps_Automation · **Model tag:** Open-source & local

~~~~
Install Ollama, then:

ollama pull [model]
ollama run [model]
ollama list

Pick a model that fits your RAM: a 7–8B parameter model in 4-bit quantization usually needs about 5–6 GB. Start small and move up only if answers are too weak.
~~~~

### 50. Quantization in plain words

**Community:** c/DevOps_Automation · **Model tag:** Open-source & local

~~~~
Quantization stores a model's weights in fewer bits to save memory. 4-bit versions (like Q4_K_M) are the usual sweet spot: much smaller with a modest quality loss. 8-bit is closer to the original but needs about twice the memory of 4-bit. If answers get noticeably worse, try the next size up.
~~~~

### 51. Set a system prompt and parameters with a Modelfile

**Community:** c/DevOps_Automation · **Model tag:** Open-source & local

~~~~
FROM [base model]
PARAMETER temperature 0.3
PARAMETER num_ctx 8192
SYSTEM """You are a concise assistant. Answer in at most 5 sentences."""

Save as Modelfile, then run: ollama create my-assistant -f Modelfile. Lower temperature gives steadier answers; raise it for brainstorming.
~~~~

### 52. Serve a local model through an OpenAI-style API

**Community:** c/DevOps_Automation · **Model tag:** Open-source & local

~~~~
Many local servers (llama.cpp server, Ollama, LM Studio) expose an OpenAI-compatible endpoint, so existing tools can point at it:

base_url = http://localhost:[port]/v1
api_key = anything (not checked locally)

Bind to 127.0.0.1 unless you really mean to expose it, and add authentication before opening it to a network.
~~~~

### 53. Estimate whether a model fits your hardware

**Community:** c/DevOps_Automation · **Model tag:** Open-source & local

~~~~
Rough rule: memory ≈ parameters × bits ÷ 8, plus overhead for context. A 7B model at 4-bit is about 3.5 GB of weights plus a GB or two for context. If you run out of VRAM, offload some layers to CPU, lower the context size or choose a smaller quantization.
~~~~

### 54. Benchmark your own setup

**Community:** c/DevOps_Automation · **Model tag:** Open-source & local

~~~~
Run the same 5 prompts on each model and write down: tokens per second, memory used, and whether the answer was usable. Use prompts from your real work, not leaderboard questions. Re-run after changing quantization or context size.
~~~~

### 55. Run a model on a laptop with no GPU

**Community:** c/DevOps_Automation · **Model tag:** Open-source & local

~~~~
A modern CPU can run a 3–8B model in 4-bit quantization at readable speeds. Close other heavy apps, choose a small context size (4k is plenty to start), and expect a few tokens per second. If it's too slow, switch to a smaller model before buying hardware.
~~~~


## c/Data_Analysis — Data analysis

Spreadsheets, SQL, statistics and charts. Prompts for cleaning, analyzing and sanity-checking data.

### 56. Explain my CSV before I analyze it

**Community:** c/Data_Analysis · **Model tag:** ChatGPT / OpenAI

~~~~
I'll paste the first 30 rows and the column headers of a dataset. Before any analysis: describe what each column probably means, flag columns with suspicious values or mixed types, list five questions the data could answer, and tell me what extra context you would need. Do not compute anything yet.
~~~~

### 57. Sanity-check an analysis before I present it

**Community:** c/Data_Analysis · **Model tag:** Claude

~~~~
Here is my analysis and the data description. Look for: confounders, survivorship bias, small samples, p-hacking risk, wrong denominators, misleading charts. For each, say whether it applies and how I'd check. Be specific to my case.
<analysis>[paste]</analysis>
~~~~

### 58. Describe a chart and critique it

**Community:** c/Data_Analysis · **Model tag:** Gemini

~~~~
I'm sharing an image of a chart. Describe what it shows in two sentences, read off the key values, then critique it: misleading axes, missing labels, wrong chart type, unclear takeaway. Suggest a better version and say how you'd build it.
~~~~

### 59. Explain a statistic someone posted online

**Community:** c/Data_Analysis · **Model tag:** Grok

~~~~
Someone claims "[statistic]". Explain what that number probably measures, where it likely comes from, what context is missing, how it could be misleading, and what a fair way to say it would be. If you can't find the source, say that clearly.
~~~~

### 60. Extract structured data from messy text

**Community:** c/Data_Analysis · **Model tag:** Llama / Meta AI

~~~~
Extract the fields below from the text and answer with JSON only, no explanation.
Fields: name (string), date (YYYY-MM-DD or null), amount (number or null), currency (3-letter code or null).
Example input: "Paid Anna 40 euros on 3 May 2025"
Example output: {"name":"Anna","date":"2025-05-03","amount":40,"currency":"EUR"}
Text: [paste]
~~~~

### 61. Write a SQL query from a description

**Community:** c/Data_Analysis · **Model tag:** Mistral

~~~~
Schema: [tables and columns]. Write a SQL query for [question]. Dialect: [Postgres/MySQL/…]. Show the query, then explain in two sentences what it does and what indexes would help.
~~~~

### 62. Find the flaw in a statistical argument

**Community:** c/Data_Analysis · **Model tag:** DeepSeek

~~~~
Read the argument below. Identify every logical or statistical flaw: confounders, base-rate neglect, cherry-picked windows, correlation vs causation. For each: quote, why it's a problem, and what data would settle it.
[paste]
~~~~

### 63. Choose the right statistical test

**Community:** c/Data_Analysis · **Model tag:** DeepSeek

~~~~
I have [describe data: variables, types, sample sizes, whether paired]. Which test is appropriate and why? State the assumptions, how to check them, and what to use if they fail. Give code for [R/Python].
~~~~

### 64. Turn a table into a chart specification

**Community:** c/Data_Analysis · **Model tag:** Qwen

~~~~
From the table below, suggest the clearest chart type for showing [question]. Write the chart as Python (matplotlib) code with labeled axes, a title, and colorblind-safe colors. Explain in one line why you chose that chart.
[table]
~~~~

### 65. Excel: ask for a formula by describing the data

**Community:** c/Data_Analysis · **Model tag:** Microsoft Copilot

~~~~
In Excel Copilot: "In column D, calculate the percentage change between column B (last year) and column C (this year). Show it as a percentage with one decimal, and highlight rows where it drops more than 10%." Then ask it to explain the formula it used.
~~~~

### 66. Excel: clean messy text columns

**Community:** c/Data_Analysis · **Model tag:** Microsoft Copilot

~~~~
My data in column A has inconsistent names (extra spaces, mixed capitals, some "Last, First"). Create a new column with "First Last" in proper case and flag rows you were not sure about. Explain each formula you used.
~~~~

### 67. Excel: summarize with a PivotTable

**Community:** c/Data_Analysis · **Model tag:** Microsoft Copilot

~~~~
Create a PivotTable from the data: rows = [category], columns = [month], values = sum of [amount]. Add a chart and write three observations a manager would care about. Point out anything unusual.
~~~~

### 68. Excel: explain a complicated workbook

**Community:** c/Data_Analysis · **Model tag:** Microsoft Copilot

~~~~
Explain how this workbook works: which sheets feed which, what the main formulas do, where manual input is required, and where errors are most likely. Then list any hard-coded numbers that should be inputs.
~~~~

### 69. Find datasets for a question

**Community:** c/Data_Analysis · **Model tag:** Perplexity

~~~~
Find public datasets I can use to study [question]. For each: source, size, years and region covered, license, known limitations, and a link. Rank them by usefulness for my question and say what's missing.
~~~~

### 70. Local embeddings for a private search

**Community:** c/Data_Analysis · **Model tag:** Open-source & local

~~~~
Use a small embedding model to turn your notes into vectors, store them in a local index, and retrieve the top 5 matches for a question. Then ask the chat model: "Answer using only these excerpts. Say 'not found' if they don't contain the answer."
~~~~

### 71. Plan an analysis before touching data

**Community:** c/Data_Analysis · **Model tag:** Multi-model / General

~~~~
I want to find out [question] using [data]. Write an analysis plan: the exact question, variables needed, how to clean them, the method, what result would convince me, and how I'd check for mistakes. No code yet.
~~~~

### 72. Ask Claude to label its confidence

**Community:** c/Data_Analysis · **Model tag:** Claude

~~~~
For each claim in your answer add a label: [high], [medium] or [low] confidence, and one phrase explaining why. List what additional data would raise a [low] to a [high]. Question: [question].
~~~~


## c/Study_Smarter — Study smarter

Learning techniques, flashcards, study plans and exam prep with AI as a tutor, not a shortcut.

### 73. Feynman check on a concept I think I understand

**Community:** c/Study_Smarter · **Model tag:** ChatGPT / OpenAI

~~~~
I'll explain [concept] in my own words. Don't correct me immediately. First list what I got right, then every place my explanation was vague, wrong or skipped a step. Then ask me two questions that would expose a deeper gap. Here is my explanation:
"""
[paste]
"""
~~~~

### 74. Teach me through questions, not lectures

**Community:** c/Study_Smarter · **Model tag:** Claude

~~~~
Teach me [topic] using the Socratic method. Start with one question to find what I already know. Each reply: confirm or gently correct my answer in one sentence, then ask the next question, slightly harder. After eight questions, summarize what I now understand and what to review.
~~~~

### 75. Turn a lecture video into study notes

**Community:** c/Study_Smarter · **Model tag:** Gemini

~~~~
Watch the video at [link or upload]. Produce: a timestamped outline, the five key ideas in one sentence each, a glossary of terms introduced, and ten flashcards (question → answer). Flag anything the speaker said that is likely outdated or disputed.
~~~~

### 76. Debate me on a topic to learn it

**Community:** c/Study_Smarter · **Model tag:** Grok

~~~~
Debate [motion] with me. You take the side opposite to mine. Make a strong argument in 120 words, then ask me to respond. Score each of my rebuttals out of 10 and tell me which logical move I missed. After three rounds, summarize what each side got right.
~~~~

### 77. One question at a time quiz

**Community:** c/Study_Smarter · **Model tag:** Llama / Meta AI

~~~~
Quiz me on [topic]. Ask one question, then stop and wait. After my answer say "Correct" or "Not quite", give a one-sentence explanation, then ask the next question. Questions get slowly harder. Keep every message under 60 words.
~~~~

### 78. Summary then quiz

**Community:** c/Study_Smarter · **Model tag:** Mistral

~~~~
Summarize [text] in 6 bullets. Then write 5 multiple-choice questions with 4 options each, and put the answers at the end under "Answers". Questions must test understanding, not memory of wording.
~~~~

### 79. Explain a proof so I can reproduce it

**Community:** c/Study_Smarter · **Model tag:** DeepSeek

~~~~
Explain the proof of [theorem] so that I can reproduce it from memory. Give: the idea in one sentence, the key lemma, the three steps, and the place where students usually get stuck. End with a similar problem to try.
~~~~

### 80. Create a flashcard deck with spaced-repetition tags

**Community:** c/Study_Smarter · **Model tag:** Qwen

~~~~
From the notes below create 20 flashcards. Format as CSV: front, back, tag. Tags: easy, medium, hard. Each card tests one fact or one idea. No card should be answerable from the question text alone.
[notes]
~~~~

### 81. Build a reading list on a topic

**Community:** c/Study_Smarter · **Model tag:** Perplexity

~~~~
Build a reading list on [topic] for a [beginner/intermediate] learner: three introductory books or courses, three key papers or articles, and two critical perspectives. For each: why it's included, how long it takes, and where to access it.
~~~~

### 82. Make flashcards from your own notes privately

**Community:** c/Study_Smarter · **Model tag:** Open-source & local

~~~~
Create 15 flashcards from these notes. One idea per card, format: Q: ... / A: ... Don't add facts that aren't in the notes. Mark any card you're not sure the notes support with "(check)".
[notes]
~~~~

### 83. A study plan that fits my calendar

**Community:** c/Study_Smarter · **Model tag:** Multi-model / General

~~~~
I have an exam on [date] covering [topics]. I can study [hours] per week on [days]. My weakest areas: [areas]. Make a week-by-week plan with spaced review, practice tests and one buffer week. Include what to do if I fall behind.
~~~~

### 84. Turn notes into active recall questions

**Community:** c/Study_Smarter · **Model tag:** Multi-model / General

~~~~
From these notes write 15 questions that require recall rather than recognition, mixed with 5 that require applying the idea to a new example. Don't include answers; I'll ask for them after I try.
[notes]
~~~~

### 85. Turn photos of handwritten notes into clean study notes

**Community:** c/Study_Smarter · **Model tag:** Gemini

~~~~
I'm uploading photos of my handwritten notes. Transcribe them, mark any word you're unsure of with [?], fix obvious spelling mistakes, then organize the content under headings and add a five-question self-test at the end. Keep my wording where it's clear.
~~~~


## c/Language_Learning — Language learning

Conversation practice, translation with context, grammar and vocabulary prompts for any language.

### 86. A conversation partner that corrects only what matters

**Community:** c/Language_Learning · **Model tag:** ChatGPT / OpenAI

~~~~
Let's chat in [language] at [CEFR level] about [topic]. Keep your replies to 2–3 short sentences. After each message of mine, add a line starting with "Fix:" that corrects at most two mistakes, the ones that most affect meaning. Don't translate unless I ask. Ask me a question every turn.
~~~~

### 87. Translate with notes, not just words

**Community:** c/Language_Learning · **Model tag:** Claude

~~~~
Translate the text into [language]. Then add a table of the five hardest phrases: literal meaning, natural meaning, register (formal/informal), and one alternative. Keep the translation natural, not word for word. Text: [paste]
~~~~

### 88. Practice reading signs from photos

**Community:** c/Language_Learning · **Model tag:** Gemini

~~~~
I'll upload photos of menus, signs or packaging in [language]. For each one: transcribe it, translate it, explain any idioms or abbreviations, and tell me one new word worth memorizing. Mention if the photo is too blurry to read a part.
~~~~

### 89. Teach me slang and when not to use it

**Community:** c/Language_Learning · **Model tag:** Grok

~~~~
Teach me five slang expressions people currently use in [language/region]. For each: meaning, example sentence, how old or informal it sounds, and a situation where it would be a bad idea. Say if the expression is fading or very regional.
~~~~

### 90. Vocabulary cards in a fixed format

**Community:** c/Language_Learning · **Model tag:** Llama / Meta AI

~~~~
Give me 10 words about [topic] in [language]. Format each as: word | translation | example sentence | translation of the sentence. One line per word. No extra comments.
~~~~

### 91. Practise French at my level

**Community:** c/Language_Learning · **Model tag:** Mistral

~~~~
Parlons en français, niveau [A2/B1/B2]. Utilise des phrases courtes. Après chacune de mes réponses, corrige au plus deux erreurs avec une courte explication en français, puis pose-moi une nouvelle question sur [sujet].
~~~~

### 92. Translate between French and English with register

**Community:** c/Language_Learning · **Model tag:** Mistral

~~~~
Traduis le texte ci-dessous en anglais. Indique le registre (formel, courant, familier) et propose une alternative pour les trois expressions les plus idiomatiques. Texte : [texte]
~~~~

### 93. Explain why a grammar rule exists

**Community:** c/Language_Learning · **Model tag:** DeepSeek

~~~~
Explain the rule behind [grammar point] in [language]. Give the historical or logical reason if there is one, three examples, the most common exception, and a trick to remember it. Don't just list the rule.
~~~~

### 94. Chinese conversation partner with pinyin on request

**Community:** c/Language_Learning · **Model tag:** Qwen

~~~~
我们用中文聊天,话题是[话题],我的水平是 HSK [级别]。请用短句回复。每次在我的句子后面指出最多两个错误并解释。只有当我输入 "pinyin" 时才给拼音。
~~~~

### 95. Translate Chinese to English with context notes

**Community:** c/Language_Learning · **Model tag:** Qwen

~~~~
Translate the Chinese text below into natural English. Then add notes for each idiom or cultural reference (chengyu, internet slang, politeness levels): literal meaning, actual meaning, and when it's used.
[text]
~~~~

### 96. Compare how a concept is expressed in three languages

**Community:** c/Language_Learning · **Model tag:** Qwen

~~~~
Show how "[concept]" is said in English, Mandarin and Spanish. For each: the usual word, a more formal or informal alternative, a typical example sentence, and any nuance that doesn't translate. Put it in a table.
~~~~

### 97. Offline language tutor

**Community:** c/Language_Learning · **Model tag:** Open-source & local

~~~~
You are a patient tutor teaching [language] to an A2 learner. Use short sentences, give a translation in brackets after new words, and correct only one mistake per message. Ask a question to keep the conversation going. This works without an internet connection when run locally.
~~~~


## c/Career_Growth — Career growth

Resumes, interviews, negotiation and difficult conversations. Prompts for getting hired and growing.

### 98. Interview me for a role, one question at a time

**Community:** c/Career_Growth · **Model tag:** ChatGPT / OpenAI

~~~~
Act as a hiring manager for [job title] at a [company type]. Ask me one interview question at a time and wait. After each of my answers give: a score from 1–5, what a strong answer would have included, and one sentence I could add. Mix behavioral, situational and one technical question. Start now.
~~~~

### 99. Tailor my resume bullets to a job posting

**Community:** c/Career_Growth · **Model tag:** Claude

~~~~
Rewrite each bullet in <resume> to match what <job_posting> emphasizes, using only facts already in the resume. Lead with outcomes and numbers. Mark any bullet where the resume gives no evidence for something the posting asks for, so I can add a true detail myself.
<resume>[paste]</resume>
<job_posting>[paste]</job_posting>
~~~~

### 100. Prepare for a presentation using my slides

**Community:** c/Career_Growth · **Model tag:** Gemini

~~~~
Review my uploaded slide deck as if you're a skeptical senior audience. For each slide: what's the one message, is the evidence enough, and what question would you ask? Then list the three questions I'm most likely to be asked and draft honest answers.
~~~~

### 101. Get unfiltered salary-negotiation coaching

**Community:** c/Career_Growth · **Model tag:** Grok

~~~~
I got an offer: [role, company, pay, benefits]. Market for this role in [location] as far as you know: [your info]. Tell me bluntly whether to negotiate, what number to ask for and why, and give me a short script for the call and one for email. List the risks.
~~~~

### 102. Cover letter from three bullet points

**Community:** c/Career_Growth · **Model tag:** Llama / Meta AI

~~~~
Write a cover letter of 180 words for [role] at [company]. Facts to use: 1) [fact] 2) [fact] 3) [fact]. Tone: warm but professional. Do not invent experience. Don't open with "I am writing to apply".
~~~~

### 103. Answer "tell me about yourself"

**Community:** c/Career_Growth · **Model tag:** Mistral

~~~~
Write three versions of an answer to "Tell me about yourself" for a [role] interview: 30 seconds, 60 seconds, 90 seconds. Use present, past, future. Base it on: [facts]. Don't exaggerate.
~~~~

### 104. Prepare for an interview in a second language

**Community:** c/Career_Growth · **Model tag:** Qwen

~~~~
I have an interview in [language] for [role]. Give me: ten likely questions, a model answer to each at B2 level, vocabulary I should know, and three phrases to buy time politely when I need to think.
~~~~

### 105. Draft a performance review self-assessment

**Community:** c/Career_Growth · **Model tag:** Microsoft Copilot

~~~~
Using my notes below, write a self-assessment: three accomplishments with measurable impact, two growth areas with what I'm doing about them, and goals for the next period. First person, honest, no inflated claims.
[notes]
~~~~

### 106. Research a company before an interview

**Community:** c/Career_Growth · **Model tag:** Perplexity

~~~~
Research [company]: what it does, recent funding or layoffs, leadership changes, product launches, public criticism, and what employees say (note the bias of review sites). Give me five questions to ask that show I've done my homework. Link sources.
~~~~

### 107. Turn experience into achievement bullets

**Community:** c/Career_Growth · **Model tag:** Multi-model / General

~~~~
Convert each task below into a resume bullet: strong verb, what I did, measurable result. If a result isn't given, write "[add number]" instead of inventing one. Keep each under 22 words.
[tasks]
~~~~

### 108. Rehearse a difficult conversation

**Community:** c/Career_Growth · **Model tag:** Multi-model / General

~~~~
Role-play [person, e.g. my manager] who is [defensive/busy/sceptical]. I need to [say what]. Respond realistically and push back. After 6 exchanges, give me feedback on clarity, tone and what I could say differently.
~~~~


## c/Business_Strategy — Business strategy

Planning, analysis, decision memos and meeting work for founders, managers and consultants.

### 109. Pre-mortem for a launch

**Community:** c/Business_Strategy · **Model tag:** ChatGPT / OpenAI

~~~~
We are launching [product] on [date]. Assume it has failed spectacularly six months later. Write 10 plausible reasons for the failure, grouped into product, market, execution and timing. Rate each by likelihood and impact (low/med/high) and propose one cheap action this month that reduces the top three.
~~~~

### 110. Turn a rambling meeting transcript into decisions

**Community:** c/Business_Strategy · **Model tag:** Claude

~~~~
From the transcript below extract: decisions made (who decided, what), action items (owner, deadline, if stated), open questions, and disagreements that were not resolved. Do not invent owners or dates; write "unassigned" when unclear.
<transcript>
[paste]
</transcript>
~~~~

### 111. Turn a spreadsheet of numbers into a briefing

**Community:** c/Business_Strategy · **Model tag:** Gemini

~~~~
Using the attached sheet, write a one-page briefing for leadership: three headline findings with the numbers, two anomalies worth checking, one recommendation and the data that supports it. State your assumptions and what you couldn't tell from the data.
~~~~

### 112. Quick pulse check on a brand

**Community:** c/Business_Strategy · **Model tag:** Grok

~~~~
What is the current sentiment about [brand] on X? Give me: what people praise, what they complain about, any ongoing controversy, and whether the conversation is growing or fading. Be honest if the sample is small or dominated by a few loud accounts.
~~~~

### 113. One-page decision memo

**Community:** c/Business_Strategy · **Model tag:** Mistral

~~~~
Write a one-page memo for [decision]. Sections: context (3 lines), options (max 3), recommendation, risks, next steps with owners. Neutral tone, no buzzwords. Facts to use: [facts].
~~~~

### 114. Unit economics sanity check

**Community:** c/Business_Strategy · **Model tag:** DeepSeek

~~~~
Given: price [x], variable cost [y], fixed cost [z], customer acquisition cost [c], churn [p% per month]. Calculate contribution margin, payback period, lifetime value and break-even customers. Show formulas and flag assumptions that look unrealistic.
~~~~

### 115. Write a bilingual customer notice

**Community:** c/Business_Strategy · **Model tag:** Qwen

~~~~
Write an announcement about [change] in both English and Simplified Chinese. Keep the same structure and level of politeness in each. Flag anything where a literal translation would sound odd and give the localized phrasing instead.
~~~~

### 116. PowerPoint: build a deck from a Word document

**Community:** c/Business_Strategy · **Model tag:** Microsoft Copilot

~~~~
Create a 10-slide presentation from the document [file]. Audience: [who]. One message per slide, a short title that states the takeaway, at most 4 bullets, and suggested visuals. End with a decision slide that says what I want the audience to do.
~~~~

### 117. PowerPoint: tighten an existing deck

**Community:** c/Business_Strategy · **Model tag:** Microsoft Copilot

~~~~
Review this presentation and suggest changes: which slides to merge or cut, which slide titles are vague, where the story jumps, and which charts need a clearer takeaway. Then rewrite the three weakest titles.
~~~~

### 118. Teams: prepare me for the next meeting

**Community:** c/Business_Strategy · **Model tag:** Microsoft Copilot

~~~~
Based on my calendar, recent emails and files about [project], prepare a briefing for tomorrow's meeting: what happened since last time, what decisions are expected, what I should ask, and any risk worth raising.
~~~~

### 119. Competitive landscape in a table

**Community:** c/Business_Strategy · **Model tag:** Perplexity

~~~~
Build a table of the main competitors for [product category] in [region]: company, product, pricing model, target customer, recent news in the last 12 months, source. Mark anything you couldn't verify.
~~~~

### 120. Market size sanity check

**Community:** c/Business_Strategy · **Model tag:** Perplexity

~~~~
Estimate the market size for [product] using two methods: top-down from published reports and bottom-up from customers × price. Show the sources and assumptions. Tell me where the numbers differ and which I should trust more.
~~~~

### 121. Logo exploration without text

**Community:** c/Business_Strategy · **Model tag:** Midjourney

~~~~
Minimal vector logo mark for [type of business], simple geometric shape, one or two colors, white background, no text, no gradients, flat design --ar 1:1 --stylize 100

Generate many, then redo the typography yourself. Image models still handle text poorly.
~~~~

### 122. Mockup scenes for a product

**Community:** c/Business_Strategy · **Model tag:** Stable Diffusion / Flux

~~~~
[product] on a [surface], in a [type of room], natural window light, soft shadows, shallow depth of field, lifestyle product photo, neutral palette. Generate a few settings, then composite your actual product image so branding stays accurate.
~~~~

### 123. Explain a business to a skeptic

**Community:** c/Business_Strategy · **Model tag:** Multi-model / General

~~~~
Here's my business idea: [idea]. You are a skeptical investor. Ask your five toughest questions, in order of how likely they would sink the idea, and after each of my answers say whether it satisfied you and why.
~~~~


## c/Marketing_Copy — Marketing copy

Headlines, emails, product pages and social posts. Prompts for clear, honest, specific copy.

### 124. Ten subject lines in ten different angles

**Community:** c/Marketing_Copy · **Model tag:** ChatGPT / OpenAI

~~~~
Write 10 email subject lines for [offer] aimed at [audience]. Use one angle per line and label it: curiosity, benefit, urgency, social proof, question, number, contrarian, story, direct, personal. Max 45 characters each. No emojis, no ALL CAPS, no fake urgency.
~~~~

### 125. Landing page copy from a product doc

**Community:** c/Marketing_Copy · **Model tag:** Gemini

~~~~
From the attached product document, write landing page copy: a headline of at most 10 words, a subhead, three benefit blocks (benefit first, feature second), one objection-handling FAQ, and a call to action. Use only claims the document supports.
~~~~

### 126. Draft a witty post without crossing into cringe

**Community:** c/Marketing_Copy · **Model tag:** Grok

~~~~
Write five posts for [brand/person] announcing [news]. Tone: dry, self-aware, a little irreverent. Max 240 characters each. No hashtags, no emojis, no "game-changer". Give one that is straightforward in case the jokes don't suit the audience.
~~~~

### 127. Reply to a critical comment without escalating

**Community:** c/Marketing_Copy · **Model tag:** Grok

~~~~
A customer posted: "[comment]". Draft three replies: apologetic, factual, and light-hearted. Max 280 characters each. Don't admit legal liability, don't argue, and invite them to a private channel if the problem is specific. Tell me which you'd pick and why.
~~~~

### 128. Product description in three lengths

**Community:** c/Marketing_Copy · **Model tag:** Llama / Meta AI

~~~~
Write a description for [product] in three lengths: 15 words, 40 words, 90 words. Label each. Use plain words, include one concrete detail, and don't use "revolutionary", "cutting-edge" or "seamless".
~~~~

### 129. Rewrite in a friendly European tone

**Community:** c/Marketing_Copy · **Model tag:** Mistral

~~~~
Rewrite this announcement for a European audience: friendly, understated, clear, no hype, no exclamation marks. Keep it under 100 words and keep all facts.
[text]
~~~~

### 130. Adapt product copy for a Chinese-speaking audience

**Community:** c/Marketing_Copy · **Model tag:** Qwen

~~~~
Adapt this English product copy for customers in [mainland China / Taiwan / Singapore]. Don't translate word for word. Adjust idioms, units, tone and calls to action to local norms and say what you changed and why.
[copy]
~~~~

### 131. Word: turn a product brief into a one-pager

**Community:** c/Marketing_Copy · **Model tag:** Microsoft Copilot

~~~~
Create a one-page summary from the brief: headline, problem, solution, three benefits, proof points (use only facts from the document) and a call to action. Format with clear headings and short paragraphs.
~~~~

### 132. What are customers complaining about?

**Community:** c/Marketing_Copy · **Model tag:** Perplexity

~~~~
Search for reviews, forums and social posts about [product/competitor]. Summarize the top 5 recurring complaints and top 5 praises with example quotes (paraphrased) and sources. Say how many sources each theme appears in.
~~~~

### 133. Social media image set with a shared visual style

**Community:** c/Marketing_Copy · **Model tag:** Midjourney

~~~~
Create four images for [campaign] that look like a series. Shared style line to append: "flat illustration, limited palette of [3 colors], thick outlines, grainy paper texture --ar 4:5 --stylize 200". Scenes: [scene 1], [scene 2], [scene 3], [scene 4].
~~~~

### 134. Social media graphics with space for text

**Community:** c/Marketing_Copy · **Model tag:** Stable Diffusion / Flux

~~~~
Compose a [style] image of [subject] positioned in the lower right, with a large clean empty area on the left for headline text, soft gradient background, high contrast. Generate without text and add typography in an editor for sharper results.
~~~~

### 135. Rewrite one message for five channels

**Community:** c/Marketing_Copy · **Model tag:** Multi-model / General

~~~~
Take this message: "[message]". Rewrite it for: email (subject + 80 words), LinkedIn post (120 words), SMS (160 characters), a headline (8 words) and a spoken 15-second radio line. Keep the same core promise and facts.
~~~~


## c/Productivity_Systems — Productivity systems

Task triage, planning, reviews, templates and personal workflows that survive a busy week.

### 136. Turn a messy brain dump into a ranked task list

**Community:** c/Productivity_Systems · **Model tag:** ChatGPT / OpenAI

~~~~
Here is everything on my mind, unsorted:
"""
[paste]
"""
Group it into: Do today (max 3), This week, Waiting on others, Someday, Delete. For each Do-today item write the very first physical action (under 10 minutes). Flag anything that has a hidden deadline.
~~~~

### 137. Project kickoff brief in one page

**Community:** c/Productivity_Systems · **Model tag:** Claude

~~~~
Write a one-page kickoff brief for [project]: goal in one sentence, non-goals, success metrics, stakeholders and their stake, milestones, top three risks with mitigations, and the first week's tasks. Ask me up to five questions first if something essential is missing.
~~~~

### 138. Draft a reply from the email thread in Gmail

**Community:** c/Productivity_Systems · **Model tag:** Gemini

~~~~
Summarize the thread in two sentences, list what each person is asking for, then draft a reply in a friendly but concise tone that answers every open question. Offer a shorter version of three lines. Thread: [use @Gmail or paste].
~~~~

### 139. Daily news brief on my topics

**Community:** c/Productivity_Systems · **Model tag:** Grok

~~~~
Each morning, give me a brief on [topics]: five items maximum, each in two sentences, with why it matters to someone who works in [field]. Mark anything that is still developing and may change. Skip celebrity gossip and anything older than 48 hours.
~~~~

### 140. Classify items into fixed labels

**Community:** c/Productivity_Systems · **Model tag:** Llama / Meta AI

~~~~
Classify each line into exactly one label: work, home, finance, health, learning, other. Reply as "line number: label", one per line, nothing else.
1. [item]
2. [item]
3. [item]
~~~~

### 141. Weekly review template

**Community:** c/Productivity_Systems · **Model tag:** Mistral

~~~~
Guide me through a weekly review in six questions, one at a time: what went well, what didn't, what's unfinished, what's coming, what can I drop, what's my one priority. After my answers, produce a plan of at most 5 items.
~~~~

### 142. Estimate a project with uncertainty

**Community:** c/Productivity_Systems · **Model tag:** DeepSeek

~~~~
Estimate [project]. Break it into tasks, give each a best, likely and worst-case time, compute the totals, and explain where the biggest uncertainty sits. Suggest the one experiment that would shrink the uncertainty most.
~~~~

### 143. Structured meeting notes in JSON

**Community:** c/Productivity_Systems · **Model tag:** Qwen

~~~~
Convert the meeting transcript into JSON with keys: date, attendees, decisions (array), action_items (array of {owner, task, due}), open_questions (array). Use null for missing information. Output JSON only.
[transcript]
~~~~

### 144. Outlook: triage my inbox

**Community:** c/Productivity_Systems · **Model tag:** Microsoft Copilot

~~~~
Summarize unread emails from the last [days] days. Group them as: need a reply from me, FYI, waiting on someone, can be ignored. For each reply-needed email give the sender, the ask and the deadline if any.
~~~~

### 145. Outlook: draft a polite decline

**Community:** c/Productivity_Systems · **Model tag:** Microsoft Copilot

~~~~
Draft a reply declining [request] from [person]. Tone: warm and firm. Offer one alternative (a later date, a smaller version or a colleague). Max 100 words. Don't over-apologize.
~~~~

### 146. Teams: recap a meeting for people who missed it

**Community:** c/Productivity_Systems · **Model tag:** Microsoft Copilot

~~~~
Recap the meeting in under 150 words: purpose, decisions, action items with owners, and open questions. List who has to do something by when. Put the most important thing first.
~~~~

### 147. Private journal reflection prompt

**Community:** c/Productivity_Systems · **Model tag:** Open-source & local

~~~~
Here is my journal entry. Don't give advice yet. Reflect back the main feelings and themes in three lines, then ask me two questions that might help me see it differently. Keep it gentle and short.
"""
[entry]
"""
~~~~

### 148. Ask the model to critique its own answer

**Community:** c/Productivity_Systems · **Model tag:** Multi-model / General

~~~~
Answer the question. Then review your answer as a skeptical expert: list the three weakest claims, what evidence would verify each, and revise the answer accordingly. Mark anything you couldn't check.
Question: [question]
~~~~

### 149. Daily plan with energy in mind

**Community:** c/Productivity_Systems · **Model tag:** Multi-model / General

~~~~
Here are my tasks for today: [list]. My energy is highest at [time] and lowest at [time]. Fixed commitments: [list]. Make a schedule that puts demanding work in high-energy slots, leaves 20% buffer, and tells me which tasks to drop first if the day goes wrong.
~~~~

### 150. Set up a ChatGPT Project once for a recurring job

**Community:** c/Productivity_Systems · **Model tag:** ChatGPT / OpenAI

~~~~
For work you repeat (weekly report, client emails, a course), create a Project and add: a short instruction ("You help me write the weekly status report: bullets, no fluff, max 200 words"), the template file, and two past examples. Then each week you only paste the new facts.
~~~~

### 151. Build a personal prompt library that you actually reuse

**Community:** c/Productivity_Systems · **Model tag:** Multi-model / General

~~~~
Keep each prompt as: name, when to use it, the prompt text with [placeholders], and one example output. Store them in a notes app or a single document and sort by task (write, analyze, decide, learn). Retire any prompt you haven't used in three months.
~~~~


## c/Cooking_Kitchen — Cooking and kitchen

Meal plans, substitutions, scaling recipes and food photography. Prompts for home cooks.

### 152. Cook from what's in my fridge

**Community:** c/Cooking_Kitchen · **Model tag:** ChatGPT / OpenAI

~~~~
I have: [ingredients]. Pantry staples: [list]. Equipment: [stove, oven, air fryer…]. Time: [minutes]. Suggest three dinners ranked by effort. For the top one give exact quantities for [number] people and numbered steps. Tell me which ingredient to buy if I'm only allowed one extra.
~~~~

### 153. Identify what's in my fridge from a photo

**Community:** c/Cooking_Kitchen · **Model tag:** Gemini

~~~~
Look at the photo of my fridge. List everything you can identify and mark what you're unsure about. Suggest three meals using mostly those items and tell me which foods look like they should be used first. Ask me before assuming anything you can't see.
~~~~

### 154. Scale a recipe correctly

**Community:** c/Cooking_Kitchen · **Model tag:** Llama / Meta AI

~~~~
Scale this recipe from [n] servings to [m]. Show a table: ingredient, original amount, new amount. Round to practical kitchen measures and mention anything that does not scale linearly (spices, baking time, pan size).
[recipe]
~~~~

### 155. A weekly meal plan with a shared shopping list

**Community:** c/Cooking_Kitchen · **Model tag:** Mistral

~~~~
Plan 5 dinners for [people], vegetarian, under [minutes] minutes each, reusing ingredients to limit waste. Then give one grocery list grouped by aisle. Avoid: [allergies or dislikes].
~~~~

### 156. Food safety question with sources

**Community:** c/Cooking_Kitchen · **Model tag:** Perplexity

~~~~
What is the safe [temperature/time/storage] for [food]? Link to official sources (e.g. food safety agencies), note differences between countries, and list the risks if I get it wrong. Say if guidance has changed recently.
~~~~

### 157. Food photography that doesn't look plastic

**Community:** c/Cooking_Kitchen · **Model tag:** Midjourney

~~~~
[dish] on a rustic ceramic plate, side light from a window, shallow depth of field, steam rising, visible texture, imperfect plating, a linen napkin, 50mm photo --ar 4:5 --stylize 100

Real food has crumbs, sheen and uneven edges. Add them.
~~~~

### 158. Recipe card images

**Community:** c/Cooking_Kitchen · **Model tag:** Stable Diffusion / Flux

~~~~
Top-down photo of [dish] on a [surface], ingredients scattered around it, natural daylight, crisp focus, muted colors, food magazine look. Keep the background simple so you can add the recipe text later.
~~~~

### 159. Substitute an ingredient and predict the result

**Community:** c/Cooking_Kitchen · **Model tag:** Multi-model / General

~~~~
I'm missing [ingredient] for [recipe]. Suggest three substitutes, say how each will change texture, taste and cooking time, and which one is the closest. Include amounts.
~~~~


## c/Fitness_Training — Fitness and training

Training plans, warm-ups, form checks and tracking. General information, not medical advice.

### 160. Build a four-week plan around my actual schedule

**Community:** c/Fitness_Training · **Model tag:** ChatGPT / OpenAI

~~~~
Make a four-week strength plan. My days available: [days]. Session length: [minutes]. Equipment: [list]. Goal: [goal]. Experience: [level]. Injuries or limits: [limits]. Give a table per week with exercises, sets × reps and an RPE target, plus one rule for when to add weight. Keep it boring and sustainable.
~~~~

### 161. Check my exercise form from a short video

**Community:** c/Fitness_Training · **Model tag:** Gemini

~~~~
I'm uploading a short video of my [exercise]. Describe what you see in each phase of the movement, point out common form issues that may apply, and give two cues I could try. You can't see everything, so say what a coach should check in person. Not medical advice.
~~~~

### 162. Convert a workout into a table

**Community:** c/Fitness_Training · **Model tag:** Llama / Meta AI

~~~~
Convert the workout below into a markdown table with columns: exercise, sets, reps, rest, notes. Keep the original order. If any info is missing write "?" instead of making it up.
[paste]
~~~~

### 163. Warm-up and mobility routine

**Community:** c/Fitness_Training · **Model tag:** Mistral

~~~~
Create a 10-minute warm-up before [sport/exercise]. Use bodyweight only, 6–8 moves, with durations. Add one alternative for each if I have [limit]. Keep instructions to one line per move.
~~~~

### 164. Check a training claim against evidence

**Community:** c/Fitness_Training · **Model tag:** Perplexity

~~~~
Is it true that "[claim]"? Find the best studies or position stands, summarize what they found in practical terms (not just p-values), and say how confident to be. Note who funded the studies if relevant.
~~~~


## c/Personal_Finance — Personal finance

Budgets, loans, fine print and financial concepts explained. Educational, not financial advice.

### 165. Stress-test my monthly budget

**Community:** c/Personal_Finance · **Model tag:** ChatGPT / OpenAI

~~~~
Here are my monthly numbers: income [x], fixed costs [list], variable spending [list], debt payments [list]. Find the three biggest levers to improve my savings rate, and run these scenarios: income drops 20%, an unexpected [amount] bill, interest rates rise 2 points. Show the math in a small table. You are not a financial adviser; list what I should verify with one.
~~~~

### 166. Explain a financial product's fine print

**Community:** c/Personal_Finance · **Model tag:** Claude

~~~~
Explain this offer in plain language: total cost over the full term, every fee and when it applies, what happens if I'm late or leave early, and what a cheaper alternative would look like. Show an example with numbers. Offer text:
"""
[paste]
"""
~~~~

### 167. Plan a big purchase over twelve months

**Community:** c/Personal_Finance · **Model tag:** Gemini

~~~~
I want to buy [item, cost] in 12 months. My monthly surplus is about [amount]. Build a saving schedule, propose where to find [x] extra per month, suggest how to time the purchase (sales, seasons), and tell me the signs I should delay. Keep a small emergency buffer.
~~~~

### 168. Explain a market move without hype

**Community:** c/Personal_Finance · **Model tag:** Grok

~~~~
[Asset or index] moved [x%] today. List plausible drivers, which are confirmed by reporting and which are speculation, and what would be worth watching next. Do not tell me what to buy or sell. Say what data you can't see.
~~~~

### 169. Categorize my transactions

**Community:** c/Personal_Finance · **Model tag:** Llama / Meta AI

~~~~
Assign one category to each transaction from this list only: housing, food, transport, health, fun, subscriptions, income, other. Output CSV with columns date, description, category. Do not change the description.
[paste]
~~~~

### 170. Compare two loan offers

**Community:** c/Personal_Finance · **Model tag:** Mistral

~~~~
Offer A: [amount, rate, term, fees]. Offer B: [amount, rate, term, fees]. Show total cost, monthly payment and APR-like comparison in a table, then say which is cheaper under early repayment. List what else I should check.
~~~~

### 171. Compare rent vs buy honestly

**Community:** c/Personal_Finance · **Model tag:** DeepSeek

~~~~
Home price [x], down payment [y], mortgage rate [r], rent [z], expected stay [years], expected appreciation [g], maintenance [m%]. Build a year-by-year comparison and find the break-even year. List the assumptions the result is most sensitive to.
~~~~

### 172. Convert and compare prices across currencies

**Community:** c/Personal_Finance · **Model tag:** Qwen

~~~~
I'm comparing [item] priced at [price A, currency, store] and [price B, currency, store]. Convert to [my currency] using rates I give: [rates], include shipping and tax [x%], and tell me which is cheaper. Explain the assumptions.
~~~~

### 173. Excel: build a simple budget tracker

**Community:** c/Personal_Finance · **Model tag:** Microsoft Copilot

~~~~
Create a monthly budget workbook: an inputs sheet (income, fixed costs), a transactions sheet, a summary sheet with spent vs. planned by category, and a chart. Add data validation for categories and conditional formatting for overspending.
~~~~

### 174. Find the current rules for something

**Community:** c/Personal_Finance · **Model tag:** Perplexity

~~~~
What are the current rules in [country/state] for [tax deduction / account type / benefit] for [year]? Link to the official source first, then list recent changes. Mention anything that depends on my situation and may need a professional.
~~~~

### 175. Explain a financial concept with an example

**Community:** c/Personal_Finance · **Model tag:** Multi-model / General

~~~~
Explain [concept, e.g. compound interest, index funds, APR] using a small numeric example. Then show how the result changes if one variable doubles. Finish with the two most common misunderstandings.
~~~~


## c/Plain_English_Legal — Plain-English legal

Reading contracts, policies and terms in plain language. Educational, not legal advice.

### 176. Read a contract clause like a skeptical friend

**Community:** c/Plain_English_Legal · **Model tag:** ChatGPT / OpenAI

~~~~
Rewrite the clause below in plain English, then list: what it obliges me to do, what it lets the other side do, any open-ended or one-sided terms, and three questions I should ask before signing. Remind me where a lawyer would be worth paying for. Clause:
"""
[paste]
"""
~~~~

### 177. Compare two versions of a document

**Community:** c/Plain_English_Legal · **Model tag:** Claude

~~~~
Compare <old> and <new>. List every substantive change as: section, what it said before, what it says now, and who benefits. Ignore formatting and typo fixes. Then list anything that was removed silently. Mark changes you are unsure about.
<old>[paste]</old>
<new>[paste]</new>
~~~~

### 178. Summarize a terms-of-service update

**Community:** c/Plain_English_Legal · **Model tag:** Gemini

~~~~
Compare the old and new terms I'm attaching. List what changed in plain language, focusing on privacy, payments, arbitration, data sharing and my right to cancel. Rank changes by how much they matter to an ordinary user. This is a summary, not legal advice.
~~~~

### 179. Summarize a policy in five bullets

**Community:** c/Plain_English_Legal · **Model tag:** Llama / Meta AI

~~~~
Summarize this privacy policy in five bullets a teenager would understand: what data is collected, why, who gets it, how long it's kept, and how to delete it. If something isn't stated, write "not stated".
[paste]
~~~~

### 180. Word: compare two contract versions

**Community:** c/Plain_English_Legal · **Model tag:** Microsoft Copilot

~~~~
Compare the current document with [file]. List changes in a table: clause, old wording, new wording, practical effect. Highlight anything that shifts risk, payment or deadlines. Don't assume legal conclusions.
~~~~

### 181. Find the actual text of a law

**Community:** c/Plain_English_Legal · **Model tag:** Perplexity

~~~~
Find the official text of [law/regulation] and summarize section [x]. Quote the key sentence, link the source and explain it in plain English. List any amendments or court decisions that changed it, and say if you can't confirm the current version.
~~~~

### 182. Summarize sensitive documents without sending them anywhere

**Community:** c/Plain_English_Legal · **Model tag:** Open-source & local

~~~~
For contracts or personal records you don't want to upload, run a local model. Prompt: "Summarize this document in 8 bullets and list every deadline, amount and party named. If something is unclear, say so." Expect to double-check the output, since small models can miss clauses.
~~~~


## c/Health_Literacy — Health literacy

Understanding terms, studies and appointments. Educational prompts, not medical advice or diagnosis.

### 183. Prepare for a doctor's appointment

**Community:** c/Health_Literacy · **Model tag:** ChatGPT / OpenAI

~~~~
I have an appointment about [topic]. Help me prepare: a one-paragraph timeline of my symptoms from the notes below, a list of questions to ask, what tests or information the doctor might want, and what to write down during the visit. Do not diagnose. Notes:
[paste]
~~~~

### 184. Explain a lab report in plain language

**Community:** c/Health_Literacy · **Model tag:** Claude

~~~~
Explain each value in the lab results below: what it measures, whether it's inside the reference range shown, and what questions I could ask my clinician. Don't diagnose or suggest treatment. Say clearly when something needs prompt medical attention.
<results>
[paste]
</results>
~~~~

### 185. Explain a health topic at three levels

**Community:** c/Health_Literacy · **Model tag:** Gemini

~~~~
Explain [condition or topic] at three levels: a 5-line summary, a detailed explanation for a patient, and a list of terms a clinician would use. Cite the kind of source each claim comes from (guideline, trial, expert opinion). Say what is still uncertain. This is education, not medical advice.
~~~~

### 186. Fact-check a viral health claim

**Community:** c/Health_Literacy · **Model tag:** Grok

~~~~
Evaluate this claim: "[claim]". What does the evidence say, how strong is it, which studies or guidelines matter, where did it likely start, and who benefits from spreading it? Rate it: supported, partly supported, unsupported, misleading. Not medical advice.
~~~~

### 187. Summarize a medicine leaflet

**Community:** c/Health_Literacy · **Model tag:** Llama / Meta AI

~~~~
From the leaflet, list in plain words: what it's for, usual way to take it, the common side effects, the signs that need urgent care, and what not to mix it with. If the leaflet doesn't say, write "not in the leaflet". This is not medical advice.
[paste]
~~~~

### 188. Evaluate a study's strength

**Community:** c/Health_Literacy · **Model tag:** DeepSeek

~~~~
Read the study summary below. Say what type of study it is, what it can and cannot show, the sample and who's missing, the effect size in absolute terms, and how confident I should be. Not medical advice.
[paste]
~~~~

### 189. Explain terminology in two languages

**Community:** c/Health_Literacy · **Model tag:** Qwen

~~~~
Explain the medical term "[term]" in plain English and in [language]. Include what it means, common causes, why it matters and when to seek care. Mention if the term has different names in the two languages. This is not medical advice.
~~~~

### 190. What do guidelines say about this?

**Community:** c/Health_Literacy · **Model tag:** Perplexity

~~~~
What do major guidelines (e.g. [organizations]) currently recommend about [topic]? Show where they agree and disagree, the evidence level cited, and the date of each guideline. Link them. This is for understanding, not for treatment decisions.
~~~~

### 191. Keep personal health notes private while organizing them

**Community:** c/Health_Literacy · **Model tag:** Open-source & local

~~~~
Organize these notes into a timeline of symptoms, medications and questions for my doctor. Don't interpret or diagnose. Only reorder and clarify what I wrote, and mark anything ambiguous. Running this locally keeps personal notes off third-party servers.
[notes]
~~~~

### 192. Build a list of questions for a specialist

**Community:** c/Health_Literacy · **Model tag:** Multi-model / General

~~~~
I'm seeing a [specialist] about [issue]. Write 12 questions grouped as: understanding the problem, tests, treatment options, risks and costs, and what to expect next. Put the most important three first. This is only to prepare for the visit.
~~~~


## c/Travel_Planning — Travel planning

Itineraries, entry rules, packing and phrases for the road.

### 193. Build a day-by-day itinerary with realistic travel time

**Community:** c/Travel_Planning · **Model tag:** ChatGPT / OpenAI

~~~~
Plan [number] days in [city] for [travelers]. Interests: [list]. Pace: [slow/medium/fast]. Budget per day: [amount]. Group stops by neighbourhood to avoid backtracking, include rough walking or transit time between stops, a lunch spot per day, and one rainy-day swap. Mark anything that needs a booking in advance.
~~~~

### 194. Plan a trip around a constraint

**Community:** c/Travel_Planning · **Model tag:** Claude

~~~~
Plan [number] days in [region] where the constraint is [no car / traveling with toddler / under €[x] per day / limited mobility]. Be honest about trade-offs and say where the constraint makes something unrealistic. Give one backup plan per day.
~~~~

### 195. Plan from a photo

**Community:** c/Travel_Planning · **Model tag:** Gemini

~~~~
Here is a photo of a place I want to visit. Guess where it might be and say how confident you are. List what to check to confirm, the best season to go, and a three-day plan nearby for a [budget] budget. Don't present guesses as certain facts.
~~~~

### 196. Find out what's going on in a city this weekend

**Community:** c/Travel_Planning · **Model tag:** Grok

~~~~
What's happening in [city] this [dates]? Events, closures, protests, big sports games or conferences that affect hotel prices or crowds. Check recent posts and news, tell me how fresh each item is, and what to double-check on official sites.
~~~~

### 197. Packing list from the weather and plan

**Community:** c/Travel_Planning · **Model tag:** Llama / Meta AI

~~~~
I'm going to [place] for [days] days. Weather: [forecast]. Activities: [list]. Make a packing list in categories (clothes, documents, tech, toiletries, extras). Mark what I can wear twice. Keep it carry-on friendly.
~~~~

### 198. Optimize a multi-city route

**Community:** c/Travel_Planning · **Model tag:** DeepSeek

~~~~
Cities: [list]. Constraints: [days, budget, no backtracking, must be at X on date]. Find a route that minimizes travel time. Show the order, the transport between stops with rough durations, and what you traded off.
~~~~

### 199. Survival phrases for a trip

**Community:** c/Travel_Planning · **Model tag:** Qwen

~~~~
I'm visiting [country] for [days]. Give me 25 phrases I'll actually use: greetings, ordering food, directions, transport, emergencies, bargaining. Show the local script, romanization and meaning. Add three cultural mistakes to avoid.
~~~~

### 200. Check entry requirements and recent changes

**Community:** c/Travel_Planning · **Model tag:** Perplexity

~~~~
What are the current entry requirements for a [nationality] citizen visiting [country] for [days]? Visa, passport validity, health requirements, customs limits, and any recent changes. Link to the official government source and give the date of each source.
~~~~

### 201. Moodboard for a trip

**Community:** c/Travel_Planning · **Model tag:** Midjourney

~~~~
Create four images that capture the feeling of [destination] in [season]: a street scene, a landscape, a food close-up and an interior. Shared style: "candid travel photography, natural light, slight film grain, warm tones" --ar 3:2. Use them to choose what to book.
~~~~

### 202. Illustrated map-style postcards

**Community:** c/Travel_Planning · **Model tag:** Stable Diffusion / Flux

~~~~
Illustrated postcard of [city], hand-painted gouache style, key landmarks arranged like a map, warm palette, decorative border, no text. Make several and pick one to print, adding labels yourself.
~~~~


## c/Image_Prompts — Image prompts

Midjourney, Stable Diffusion and Flux prompts, parameters and workflows for generating better images.

### 203. Aspect ratio and stylize: the two switches that change most

**Community:** c/Image_Prompts · **Model tag:** Midjourney

~~~~
Start every prompt with the subject, then add parameters at the end:

a lighthouse on a cliff at dusk, storm clouds, long exposure --ar 3:2 --stylize 150

--ar sets the shape (16:9 wide, 2:3 portrait, 1:1 square). Lower --stylize (0–100) follows your words more literally; higher (500+) gives Midjourney more freedom and a more "artistic" result.
~~~~

### 204. Use --chaos to explore, then lock the winner with --seed

**Community:** c/Image_Prompts · **Model tag:** Midjourney

~~~~
Run an exploratory batch with variety:

an abandoned greenhouse overgrown with ferns, soft morning light --chaos 40 --ar 4:5

Pick the best image, note its seed, then iterate with small wording changes and the same --seed to compare changes fairly.
~~~~

### 205. Remove what you don't want with --no

**Community:** c/Image_Prompts · **Model tag:** Midjourney

~~~~
Negative words in the prompt can backfire ("no people" may add people). Use the parameter instead:

a quiet street café in Lisbon, golden hour, 35mm photo --no people, cars, text, watermark --ar 3:2
~~~~

### 206. Describe light, lens and time of day instead of "beautiful"

**Community:** c/Image_Prompts · **Model tag:** Midjourney

~~~~
Weak: "a beautiful portrait of an old fisherman". Stronger:

portrait of an elderly fisherman mending nets, overcast light, shallow depth of field, 85mm lens, textured skin, muted colors, film grain --ar 4:5

Light + lens + materials + mood do more than adjectives like "stunning" or "epic".
~~~~

### 207. Consistent character across a series

**Community:** c/Image_Prompts · **Model tag:** Midjourney

~~~~
Describe the character once in fixed words and reuse it verbatim:

"a woman in her thirties, short silver hair, round tortoiseshell glasses, olive green wool coat" + [new scene] --ar 3:2

Use the same wording and style parameters each time. Keep changes to the scene only, and expect small variations.
~~~~

### 208. Product photography on a seamless background

**Community:** c/Image_Prompts · **Model tag:** Midjourney

~~~~
[product], centered, studio lighting with a soft key light and subtle shadow, seamless [color] backdrop, high detail, commercial product photo, no text --ar 1:1 --stylize 80

Try swapping the light: "hard side light", "top-down softbox", "rim light" to see which fits the brand.
~~~~

### 209. Interior design variations

**Community:** c/Image_Prompts · **Model tag:** Midjourney

~~~~
a [style] living room, [color palette], [key furniture pieces], natural light from large windows, wide-angle architectural photo, realistic materials --ar 3:2

Change one variable at a time (floor, sofa color, lighting) to compare.
~~~~

### 210. Use an image as a reference with a weight

**Community:** c/Image_Prompts · **Model tag:** Midjourney

~~~~
Attach a reference image URL at the start of the prompt, then add words:

[image URL] a cozy cabin in winter, same color palette, similar composition --iw 1.5

--iw raises or lowers how strongly the reference shapes the result. Start around 1 and move in 0.5 steps.
~~~~

### 211. Pattern and texture for design work

**Community:** c/Image_Prompts · **Model tag:** Midjourney

~~~~
seamless pattern of [motif], hand-drawn, [color palette], flat background, repeating tile, no shadows --tile --ar 1:1

Check the edges after upscaling. Small visible seams often need a quick fix in an editor.
~~~~

### 212. Retro poster style without copying anyone

**Community:** c/Image_Prompts · **Model tag:** Midjourney

~~~~
[subject], vintage travel poster style, bold flat shapes, limited four-color palette, strong silhouettes, textured print grain, large empty area at the top for a title --ar 2:3

Describing the techniques is enough. No need to name a living artist.
~~~~

### 213. Macro and miniature scenes

**Community:** c/Image_Prompts · **Model tag:** Midjourney

~~~~
macro photo of a tiny [object] world, tilt-shift effect, shallow depth of field, real scale cues like coins or fingers, soft daylight --ar 3:2

Words like "macro", "tilt-shift" and "scale cues" help it commit to a convincing tiny scale.
~~~~

### 214. Iterate with variation, not from scratch

**Community:** c/Image_Prompts · **Model tag:** Midjourney

~~~~
When one image is almost right: use Vary (Subtle) to keep composition, Vary (Strong) to change more, and edit the prompt only for the part you dislike. Write down which phrase caused which change so you build your own prompt vocabulary.
~~~~

### 215. Token weighting in Automatic1111-style UIs

**Community:** c/Image_Prompts · **Model tag:** Stable Diffusion / Flux

~~~~
Raise or lower the importance of a phrase with parentheses and a number:

portrait of a knight, (intricate armor:1.3), (soft rim light:1.1), (blurry background:0.8)

Values above 1.5 often distort the image. Keep changes small and test one at a time.
~~~~

### 216. Negative prompt starter set for SD 1.5 / SDXL models

**Community:** c/Image_Prompts · **Model tag:** Stable Diffusion / Flux

~~~~
Negative prompt: lowres, blurry, jpeg artifacts, extra fingers, malformed hands, cropped, watermark, text, signature, oversaturated

Adjust per model: some checkpoints respond to short negative prompts better than long lists. Remove items that don't change anything.
~~~~

### 217. Flux prompts: write full sentences, skip negative prompts

**Community:** c/Image_Prompts · **Model tag:** Stable Diffusion / Flux

~~~~
Flux-style models respond well to natural language and generally don't use negative prompts. Describe what you want:

A candid photo of a street musician playing violin at night under a warm streetlamp, wet pavement reflecting the light, shallow depth of field, grainy 35mm film look.

Put the most important details first.
~~~~

### 218. Pick sampler, steps and CFG sensibly

**Community:** c/Image_Prompts · **Model tag:** Stable Diffusion / Flux

~~~~
A solid starting point: 25–30 steps, CFG 5–7 for SD 1.5/SDXL. Higher CFG makes the model follow the prompt more strictly but can fry colors. If an image looks overcooked, lower CFG before touching anything else. Change one setting per test and fix the seed to compare.
~~~~

### 219. Fix faces and hands with inpainting

**Community:** c/Image_Prompts · **Model tag:** Stable Diffusion / Flux

~~~~
Generate the whole scene first. Then mask only the face (or hand), set denoising strength around 0.3–0.5 so identity is kept, and use a short prompt about just that area: "detailed face, natural skin, sharp eyes". Increase the mask padding if the result looks pasted on.
~~~~

### 220. Use img2img to turn a rough sketch into a finished image

**Community:** c/Image_Prompts · **Model tag:** Stable Diffusion / Flux

~~~~
Upload your sketch, write a prompt describing the final look, and start with denoising strength 0.6. Lower keeps your composition; higher gives the model more freedom. Use a ControlNet (scribble or lineart) if you need the layout locked exactly.
~~~~

### 221. LoRA basics: trigger words and weights

**Community:** c/Image_Prompts · **Model tag:** Stable Diffusion / Flux

~~~~
Load a LoRA by adding its tag to the prompt, e.g. <lora:name:0.8>, plus its trigger word if the model page lists one. Start at weight 0.6–0.8; above 1.0 often burns the style into everything. Stack LoRAs one at a time so you know which does what.
~~~~

### 222. Upscale without inventing new details

**Community:** c/Image_Prompts · **Model tag:** Stable Diffusion / Flux

~~~~
Generate at a normal size (e.g. 1024 px for SDXL), then use an upscaler model for 2×. For "hires fix" keep denoising at 0.3–0.45 to avoid changing faces or objects. If details turn mushy, try a different upscaler before increasing steps.
~~~~

### 223. Build consistent style with a fixed prefix

**Community:** c/Image_Prompts · **Model tag:** Stable Diffusion / Flux

~~~~
Keep a prompt prefix that defines your style, and only change the subject:

"[STYLE] watercolor illustration, soft edges, pastel palette, visible paper grain, [SUBJECT]"

Save the prefix, seed range and settings with each image so you can rebuild the look later.
~~~~

### 224. Architectural visualization from a plan

**Community:** c/Image_Prompts · **Model tag:** Stable Diffusion / Flux

~~~~
Use a ControlNet with a simple line drawing or depth map of the building, and prompt: "modern [style] house, [materials], golden hour, landscaped garden, architectural photography, wide angle". Lock the geometry with ControlNet strength around 0.8.
~~~~

### 225. Troubleshoot "muddy" results

**Community:** c/Image_Prompts · **Model tag:** Stable Diffusion / Flux

~~~~
Checklist when images look muddy: lower CFG a notch, remove contradictory style words, try a different VAE, shorten the prompt, raise steps a little, and change the sampler. Fix the seed while testing so you can see which change actually helped.
~~~~

### 226. Compare prompt changes fairly with an X/Y plot

**Community:** c/Image_Prompts · **Model tag:** Stable Diffusion / Flux

~~~~
Use the X/Y/Z plot script to vary one thing across a grid, for example CFG 4, 6, 8 on one axis and sampler on the other, with the seed fixed. A grid lets you see which setting actually causes a difference instead of guessing from separate images.
~~~~


## c/Research_Science — Research and science

Literature review, reading papers, experimental design and checking claims against sources.

### 227. Summarize a paper with its limits attached

**Community:** c/Research_Science · **Model tag:** ChatGPT / OpenAI

~~~~
Summarize the paper below in: the question, the method in two sentences, the main result with the actual numbers, three limitations the authors admit or should admit, and what a skeptical reviewer would ask for next. Do not add claims that are not in the text.
"""
[paste abstract or full text]
"""
~~~~

### 228. Ask Claude to quote before it answers

**Community:** c/Research_Science · **Model tag:** Claude

~~~~
For long documents, ask for evidence first:

Read the report below. First extract the exact quotes relevant to the question inside <quotes> tags. Then answer the question using only those quotes, and say "not in the document" if they do not support an answer.

<question>[question]</question>
<report>[paste]</report>
~~~~

### 229. Ask a question about a very long document

**Community:** c/Research_Science · **Model tag:** Gemini

~~~~
I'm uploading a long document ([pages] pages). Answer only from it. For each answer, give the section or page and a one-line quote that supports it. If the document does not answer the question, say so instead of guessing. Question: [question].
~~~~

### 230. Ask Grok what people are actually saying about a topic

**Community:** c/Research_Science · **Model tag:** Grok

~~~~
Search recent posts on X about [topic] from the last [days] days. Summarize the three main viewpoints, name the types of accounts pushing each (researchers, companies, hobbyists, bots), and show one representative post per viewpoint. Separate verified facts from rumor and tell me which claims lack a source.
~~~~

### 231. Compare two methods in a table

**Community:** c/Research_Science · **Model tag:** Mistral

~~~~
Compare [method A] and [method B] in a table with rows: how it works, strengths, weaknesses, typical use, cost, common mistakes. Keep each cell under 15 words. Say where experts disagree.
~~~~

### 232. Work through a hard math problem carefully

**Community:** c/Research_Science · **Model tag:** DeepSeek

~~~~
Solve the following problem. After you reach an answer, verify it by a second, different method (or by substituting back). If the two disagree, find the error. Give only the final answer and the verification summary, not every step.
Problem: [problem]
~~~~

### 233. Critique an experimental design

**Community:** c/Research_Science · **Model tag:** DeepSeek

~~~~
Here is my experiment design. List threats to internal and external validity, missing controls, the likely sample size needed for [effect size], and what I should preregister. Be specific to this design.
[paste]
~~~~

### 234. Long document Q&A with sections cited

**Community:** c/Research_Science · **Model tag:** Qwen

~~~~
Read the document and answer the question. Cite each claim as (Section X, Paragraph Y). If a claim has no support, mark it as "not in document". Question: [question].
[document]
~~~~

### 235. Ask a question that forces cited, recent answers

**Community:** c/Research_Science · **Model tag:** Perplexity

~~~~
Use a question shape that rewards sources: "What did [2–3 named sources or institutions] publish about [topic] since [date]? Summarize each source's main finding with a link and note where they disagree." Then check the links yourself.
~~~~

### 236. Compare studies on a contested question

**Community:** c/Research_Science · **Model tag:** Perplexity

~~~~
What does the research say about [question]? List the strongest studies on each side with sample size and year, say which kind of evidence each is (RCT, cohort, review), and explain why they may disagree. Link every claim.
~~~~

### 237. Find primary sources for a claim

**Community:** c/Research_Science · **Model tag:** Perplexity

~~~~
I saw the claim "[claim]". Find the original source (paper, dataset, filing, speech) rather than articles about it. Give the link, the exact wording there, and any part the claim exaggerates or leaves out.
~~~~

### 238. Chunk long documents for a small context window

**Community:** c/Research_Science · **Model tag:** Open-source & local

~~~~
If the model's context is 8k tokens, split a long text into ~1,500-word chunks. Summarize each chunk with the same prompt, then summarize the summaries. Ask for "key claims with page references" at each stage so nothing important is lost.
~~~~

### 239. Make the model separate fact from inference

**Community:** c/Research_Science · **Model tag:** Multi-model / General

~~~~
Answer in two sections: "What the source says" (direct statements only, with locations) and "What I'm inferring" (conclusions that go beyond the text). Mark confidence as high, medium or low for each inference.
[source]
~~~~

### 240. Put the long document first, the question last

**Community:** c/Research_Science · **Model tag:** Claude

~~~~
With long inputs, place the material at the top and your question at the end:

<document>[paste long text]</document>

Based on the document above, [question]. Quote the passages you relied on.

Ending with the question tends to produce more focused answers than burying the document under instructions.
~~~~


## c/Decision_Making — Decision making

Thinking tools and mental models: pre-mortems, inversion, trade-offs and honest second opinions.

### 241. Argue against my plan

**Community:** c/Decision_Making · **Model tag:** ChatGPT / OpenAI

~~~~
I'm planning to [decision]. Steelman the strongest case against it in five points. Then tell me which assumptions I'm making that I have not verified, and what evidence would change your mind either way. Be blunt, not harsh.
~~~~

### 242. Think out loud before deciding

**Community:** c/Decision_Making · **Model tag:** Claude

~~~~
Before you answer, reason through the problem step by step inside <thinking> tags: list the options, the criteria that matter, and the evidence for each. Then give your recommendation in <answer> tags in three sentences. Problem: [problem].
~~~~

### 243. Compare options with a weighted matrix

**Community:** c/Decision_Making · **Model tag:** Gemini

~~~~
Help me choose between [options]. Ask me for the 5–7 criteria that matter and weights that sum to 100. Score each option 1–5 per criterion with a one-line reason, show the weighted totals in a table, then tell me what would flip the ranking.
~~~~

### 244. Play devil's advocate with attitude

**Community:** c/Decision_Making · **Model tag:** Grok

~~~~
I'm about to [decision]. Take the opposite side and argue it like a sharp friend who has seen this go wrong: three reasons it might fail, one thing I'm in denial about, and one honest question I'd rather not answer. No hedging, but no cruelty.
~~~~

### 245. Pros and cons with weights

**Community:** c/Decision_Making · **Model tag:** Llama / Meta AI

~~~~
Decision: [decision]. List up to five pros and five cons. Give each a weight 1–5 for how much it matters. Add up both sides and show the totals. Then name one factor missing from my list.
~~~~

### 246. Expected value of a risky choice

**Community:** c/Decision_Making · **Model tag:** DeepSeek

~~~~
Option A: [outcome and probability]. Option B: [outcome and probability]. Compute the expected value for each, then show how the ranking changes if my probability estimates are off by 10 points. State what the expected value ignores (risk tolerance, ruin).
~~~~

### 247. Gather evidence on both sides

**Community:** c/Decision_Making · **Model tag:** Perplexity

~~~~
I'm deciding whether to [decision]. Gather the best evidence for and against from credible sources, including real-world case studies and data. For each point give a source and how strong it is. Finish with what I'd need to know about my own situation.
~~~~

### 248. Inversion: how would this fail?

**Community:** c/Decision_Making · **Model tag:** Multi-model / General

~~~~
Instead of asking how to succeed at [goal], tell me how to guarantee failure. List the ten most reliable ways. Then flip each into a rule I should follow and mark the three that I'm currently most at risk of breaking.
~~~~

### 249. Second-order effects

**Community:** c/Decision_Making · **Model tag:** Multi-model / General

~~~~
I'm considering [decision]. List the likely first-order effects, then second-order and third-order effects, in 6, 12 and 36 months. Mark which are certain, likely or speculative, and which would be hard to reverse.
~~~~

### 250. Regret minimization check

**Community:** c/Decision_Making · **Model tag:** Multi-model / General

~~~~
Imagine I'm 80 looking back. For [decision], describe what I'd likely regret about doing it, and what I'd regret about not doing it. Then ask me three questions to clarify which regret is bigger.
~~~~
