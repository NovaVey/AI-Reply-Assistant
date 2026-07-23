# AI Reply Assistant

AI Reply Assistant is a full-stack Node.js application that helps small businesses respond to
customer inquiries faster. Incoming inquiries (emails, contact-form messages, etc.) are logged in
a Postgres database, and with one click the app calls the Claude API to draft a reply that is
personalized to your business — using a description of your business, the services you offer, your
preferred tone, and your sign-off — so every draft sounds like it came from you. Staff can review,
edit, and approve each draft before it's considered final, and every inquiry is tracked through a
simple pending → drafted → approved status pipeline.

## Features

- **Business context personalization** — a single settings screen where you describe your business,
  services, tone, and sign-off; this context is fed into every AI-generated draft so replies actually
  sound like your business instead of a generic assistant.
- **AI draft generation** — generate a customer-reply draft for any inquiry with one click, powered
  by the Claude API (`@anthropic-ai/sdk`).
- **Editable, approvable drafts** — drafts are never sent automatically. Edit the generated text
  in-place and approve it when it's ready; the original AI draft and your edited version are both
  stored.
- **Status tracking** — every inquiry moves through `pending` → `drafted` → `approved`, with clear,
  color-coded status badges in the UI.
- **Demo example-inquiry buttons** — a "Test: Submit Inquiry" tab with one-click example buttons
  that fill in realistic sample customer messages (pricing, availability, complaints, general
  questions), so you can try the full flow without writing your own test data.

## Tech Stack

- **Backend:** Node.js, Express
- **Database:** PostgreSQL (via `pg`)
- **AI:** Claude API (`@anthropic-ai/sdk`)
- **Frontend:** Vanilla HTML, CSS, and JavaScript (no build step, no framework)

## Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/NovaVey/ai-reply-assistant.git
   cd ai-reply-assistant
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment variables**

   Copy `.env.example` to `.env` and fill in the values:

   ```bash
   cp .env.example .env
   ```

   | Variable | Description |
   |---|---|
   | `PORT` | Port the Express server listens on (defaults to `3003`). |
   | `DATABASE_URL` | Postgres connection string, e.g. `postgresql://user:password@localhost:5432/ai_reply_assistant`. |
   | `ANTHROPIC_API_KEY` | Your Anthropic API key. **Required for AI draft generation to work** — without it, everything else in the app (inquiries, business setup) will still function, but generating a draft reply will fail. |

4. **Create the database**

   Create a Postgres database matching your `DATABASE_URL` (e.g. `ai_reply_assistant`):

   ```bash
   createdb ai_reply_assistant
   ```

5. **Initialize the schema**

   ```bash
   npm run db:init
   ```

   This runs `backend/db/schema.sql` against `$DATABASE_URL`, creating the `business_context`,
   `inquiries`, and `replies` tables (and seeding a default business context row).

6. **Run the app**

   ```bash
   npm run dev    # with nodemon, auto-restarts on file changes
   # or
   npm start       # plain node
   ```

   Then open `http://localhost:3003` in your browser.

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/business` | Get the current business context (name, description, services, tone, sign-off). |
| `PUT` | `/api/business` | Update the business context. |
| `GET` | `/api/inquiries` | List inquiries, newest first. Optional `?status=pending\|drafted\|approved` filter. |
| `GET` | `/api/inquiries/:id` | Get a single inquiry, including its reply (if one exists). |
| `POST` | `/api/inquiries` | Submit a new inquiry. |
| `POST` | `/api/inquiries/:id/draft` | Generate (or regenerate) an AI draft reply for an inquiry. |
| `PATCH` | `/api/inquiries/:id/approve` | Save the final edited reply text and mark the inquiry approved. |
| `DELETE` | `/api/inquiries/:id` | Delete an inquiry (and its reply, if any). |

## Testing

The backend has a real, runnable integration test suite (`tests/`) that exercises the full Express
app in-process against a real PostgreSQL database, using Node's built-in test runner
(`node --test`), [supertest](https://github.com/ladjs/supertest) for HTTP assertions, and
[nock](https://github.com/nock/nock) to intercept and mock the Claude API — no real network call to
Anthropic is ever made.

1. **Install dependencies** (if you haven't already)

   ```bash
   npm install
   ```

2. **Create a test database**

   Tests run against their own local PostgreSQL database, separate from your dev database:

   ```bash
   createdb ai_reply_assistant_test
   ```

3. **Run the tests**, pointing `DATABASE_URL` at that database:

   ```bash
   DATABASE_URL=postgresql://postgres@localhost:5432/ai_reply_assistant_test npm test
   ```

   The suite applies `backend/db/schema.sql` and resets its tables between tests automatically, so
   no separate `db:init` step is needed for the test database. You do **not** need an
   `ANTHROPIC_API_KEY` to run the tests — the Claude API is fully mocked with `nock`.

## Project Structure

```
AI-Reply-Assistant/
├── backend/
│   ├── server.js              # Express app entry point
│   ├── db/
│   │   ├── schema.sql         # Database schema + seed data
│   │   └── pool.js            # Shared pg Pool instance
│   ├── routes/
│   │   ├── inquiries.js       # /api/inquiries routes
│   │   └── business.js        # /api/business routes
│   └── services/
│       └── claudeService.js   # Claude API integration (draft generation)
├── frontend/
│   └── public/
│       └── index.html         # Single-page vanilla HTML/CSS/JS frontend
├── .env.example
├── package.json
├── README.md
└── LICENSE
```

## License

See [LICENSE](LICENSE).
