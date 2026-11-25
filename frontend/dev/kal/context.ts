"use client";

import { createContext } from "react";
import type { World } from "./world";

export const KalWorld = createContext<World | null>(null);
