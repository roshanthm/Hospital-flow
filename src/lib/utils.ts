/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateToken(count: number) {
  const year = new Date().getFullYear();
  const sequence = String(count).padStart(4, '0');
  return `OP-${year}-${sequence}`;
}

export function generateStaffCredentials(role: string, name: string, count: number = 0, employeeId?: string) {
  const passId = Math.floor(100000 + Math.random() * 900000);
  
  let prefix = 'STF';
  if (role === 'DOCTOR') prefix = 'DOC';
  if (role === 'RECEPTION') prefix = 'REC';
  if (role === 'PHARMACY') prefix = 'PHA';
  if (role === 'ADMIN') prefix = 'ADM';

  if (employeeId && employeeId.trim() && employeeId.trim().toUpperCase() !== 'N/A') {
    const cleanRole = role.toLowerCase();
    const cleanEmpId = employeeId.trim().toLowerCase().replace(/\s+/g, '');
    return {
      email: `${cleanRole}.${cleanEmpId}@hospital.local`,
      password: `${prefix}${passId}`
    };
  }

  const sequence = String(count + 1).padStart(3, '0');
  const baseEmail = name.toLowerCase().replace(/\s+/g, '_');
  return {
    email: `${baseEmail}_${sequence}@hospital.com`,
    password: `${prefix}${passId}`
  };
}

export function formatDate(date: string | Date) {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatTime(time: string) {
  return time;
}
