export type GoalState = 'proposed' | 'active' | 'completed' | 'failed' | 'cancelled';

export interface GoalTask {
  id: string;
  instruction: string;
  state: 'queued' | 'running' | 'waiting' | 'completed' | 'failed';
}

export interface Goal {
  id: string;
  description: string;
  source: string;
  state: GoalState;
  tasks: GoalTask[];
  createdAt: number;
  updatedAt: number;
}

export class GoalManager {
  private readonly goals: Goal[] = [];

  createGoal(description: string, source = 'developer.task'): Goal {
    const now = Date.now();
    const goal: Goal = {
      id: `goal-${now.toString(36)}-${(this.goals.length + 1).toString(36)}`,
      description,
      source,
      state: 'proposed',
      tasks: [],
      createdAt: now,
      updatedAt: now,
    };
    this.goals.push(goal);
    return goal;
  }

  snapshot(): Goal[] {
    return JSON.parse(JSON.stringify(this.goals.slice(-20))) as Goal[];
  }
}
