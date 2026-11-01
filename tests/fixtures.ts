import type { EstimateDraft } from "../lib/estimate";

export interface FakeRoute {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface FakeFetch {
  fetch: typeof fetch;
  requests: Array<{ url: string; headers: Headers }>;
}

/** A fetch that answers from a URL → response map, and records every request. */
export function fakeFetch(routes: Record<string, FakeRoute>): FakeFetch {
  const requests: FakeFetch["requests"] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, headers: new Headers(init?.headers) });
    const route = routes[url];
    if (!route) return new Response("Not Found", { status: 404 });
    const body = typeof route.body === "string" ? route.body : JSON.stringify(route.body);
    return new Response(body, { status: route.status ?? 200, headers: route.headers });
  };
  return { fetch: impl as typeof fetch, requests };
}

interface RepoFixture {
  owner: string;
  repo: string;
  description: string;
  languages: Record<string, number>;
  files: Record<string, string>;
}

/** Builds the GitHub API and raw-content routes for a small public repository. */
export function repoRoutes(fixture: RepoFixture): Record<string, FakeRoute> {
  const api = `https://api.github.com/repos/${fixture.owner}/${fixture.repo}`;
  const raw = `https://raw.githubusercontent.com/${fixture.owner}/${fixture.repo}/main`;
  const routes: Record<string, FakeRoute> = {
    [api]: {
      body: {
        html_url: `https://github.com/${fixture.owner}/${fixture.repo}`,
        default_branch: "main",
        description: fixture.description,
        stargazers_count: 12,
        license: { spdx_id: "MIT", name: "MIT License" },
        pushed_at: "2025-12-09T06:53:36Z",
        private: false,
      },
    },
    [`${api}/languages`]: { body: fixture.languages },
    [`${api}/git/trees/main?recursive=1`]: {
      body: {
        truncated: false,
        tree: Object.entries(fixture.files).map(([path, text]) => ({
          path,
          type: "blob",
          size: new TextEncoder().encode(text).length,
        })),
      },
    },
  };
  for (const [path, text] of Object.entries(fixture.files)) routes[`${raw}/${path}`] = { body: text };
  return routes;
}

export const reactApp: RepoFixture = {
  owner: "acme",
  repo: "food-app",
  description: "A food ordering app",
  languages: { JavaScript: 9000, CSS: 3000 },
  files: {
    "README.md": "# Food app\nOrder food online.",
    "package.json": JSON.stringify({
      name: "food-app",
      dependencies: {
        react: "^19.2.1",
        "react-dom": "^19.2.1",
        "react-router-dom": "^7.10.1",
        "react-scripts": "5.0.1",
        axios: "^1.13.2",
      },
    }),
    "package-lock.json": "{}",
    "src/index.js": "import App from './App';\nrender(<App />);\n",
    "src/App.jsx": "export default function App() {\n  return <main>Food</main>;\n}\n",
    "src/context/CartContext.jsx": "export const CartContext = createContext();\n",
    "src/App.test.js": "test('renders', () => {});\n",
    "node_modules/react/index.js": "module.exports = {};\n",
    "public/logo.png": "PNG",
  },
};

export const flaskApi: RepoFixture = {
  owner: "acme",
  repo: "flask-api",
  description: "An inventory API",
  languages: { Python: 12000 },
  files: {
    "requirements.txt": "Flask==2.3.3\nSQLAlchemy>=2.0.23\npytest==7.4.0\n",
    "app.py": "from flask import Flask\napp = Flask(__name__)\n",
    "tests/test_app.py": "def test_ok():\n    assert True\n",
  },
};

export const estimateDraft: EstimateDraft = {
  complexity: "medium",
  complexityReason: "A small app with a few contexts and routes.",
  confidence: "medium",
  workItems: [
    { name: "Setup", description: "Create the new project", hoursLow: 10, hoursHigh: 20 },
    { name: "Port pages", description: "Move pages and routing", hoursLow: 5, hoursHigh: 10 },
  ],
  risks: [{ title: "Routing differences", likelihood: "medium", impact: "high", mitigation: "Port routes first" }],
  assumptions: ["One experienced developer"],
};
