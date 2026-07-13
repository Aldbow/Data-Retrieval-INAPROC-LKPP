import { NextResponse } from 'next/server';

export interface ApiResponse<T = any> {
  success: boolean;
  data: T | null;
  error: string | null;
  meta?: Record<string, any>;
}

export class ApiResponder {
  static success<T>(data: T, meta?: Record<string, any>, status = 200) {
    const payload: ApiResponse<T> = {
      success: true,
      data,
      error: null,
    };
    if (meta) {
      payload.meta = meta;
    }
    return NextResponse.json(payload, { status });
  }

  static error(message: string, status = 400, meta?: Record<string, any>) {
    const payload: ApiResponse<null> = {
      success: false,
      data: null,
      error: message,
    };
    if (meta) {
      payload.meta = meta;
    }
    return NextResponse.json(payload, { status });
  }
}
