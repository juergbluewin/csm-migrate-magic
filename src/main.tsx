import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initNetworkLogging } from "./lib/setupNetworkLogging";

// Initialize network logging after imports are done
initNetworkLogging();

createRoot(document.getElementById("root")!).render(<App />);

