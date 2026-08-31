/**
 * PeriodTracker.js - UI Controller & Module for Period Tracking Lifecycle
 * Handles Visual Calendar, Flow Tracking, Ovulation Window, and Pain Levels
 */

import { managerService } from '../services/managerService.js';

export class PeriodTrackerPage {
  constructor(locale = 'en') {
    this.locale = locale;
    this.currentDate = new Date();
    this.selectedDay = null;
  }

  async init() {
    try {
      const [analytics, notifications, cycles] = await Promise.all([
        managerService.getAnalytics(),
        managerService.getNotifications(),
        managerService.getCycles()
      ]);
      return { analytics, notifications, cycles };
    } catch (err) {
      console.error('Failed to load period tracker data:', err);
      return null;
    }
  }

  calculateOvulationWindow(lastPeriodDate, cycleLength = 28) {
    if (!lastPeriodDate) return null;
    const start = new Date(lastPeriodDate);
    const ovulation = new Date(start);
    ovulation.setDate(ovulation.getDate() + (cycleLength - 14));

    const fertileStart = new Date(ovulation);
    fertileStart.setDate(fertileStart.getDate() - 3);

    const fertileEnd = new Date(ovulation);
    fertileEnd.setDate(fertileEnd.getDate() + 2);

    return {
      ovulationDate: ovulation.toISOString().split('T')[0],
      fertileStart: fertileStart.toISOString().split('T')[0],
      fertileEnd: fertileEnd.toISOString().split('T')[0]
    };
  }

  async logPeriodEntry({ date, cycleLength, periodLength, flowIntensity, painLevel, painLocations, ovulationSymptoms, notes }) {
    return managerService.logCycle({
      last_period_date: date,
      cycle_length: cycleLength,
      period_length: periodLength,
      flow_intensity: flowIntensity || 'medium',
      pain_level: painLevel || 5,
      pain_locations: painLocations || '',
      ovulation_symptoms: ovulationSymptoms || '',
      notes: notes || ''
    });
  }
}

export default PeriodTrackerPage;
