import "server-only";
import { createRuntime } from "@boxrush/services";

export const getCtx = () => createRuntime();
