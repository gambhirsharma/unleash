import { IUnleashConfig } from '../types/option';
import { IEventStore } from '../types/stores/event-store';
import { IClientSegment, IUnleashStores } from '../types';
import { Logger } from '../logger';
import NameExistsError from '../error/name-exists-error';
import { ISegmentStore } from '../types/stores/segment-store';
import { IFeatureStrategy, ISegment } from '../types/model';
import { segmentSchema } from './segment-schema';
import {
    SEGMENT_CREATED,
    SEGMENT_DELETED,
    SEGMENT_UPDATED,
} from '../types/events';
import User from '../types/user';
import { IFeatureStrategiesStore } from '../types/stores/feature-strategies-store';
import BadDataError from '../error/bad-data-error';
import { ISegmentService } from '../segments/segment-service-interface';

export class SegmentService implements ISegmentService {
    private logger: Logger;

    private segmentStore: ISegmentStore;

    private featureStrategiesStore: IFeatureStrategiesStore;

    private eventStore: IEventStore;

    private config: IUnleashConfig;

    constructor(
        {
            segmentStore,
            featureStrategiesStore,
            eventStore,
        }: Pick<
            IUnleashStores,
            'segmentStore' | 'featureStrategiesStore' | 'eventStore'
        >,
        config: IUnleashConfig,
    ) {
        this.segmentStore = segmentStore;
        this.featureStrategiesStore = featureStrategiesStore;
        this.eventStore = eventStore;
        this.logger = config.getLogger('services/segment-service.ts');
        this.config = config;
    }

    async get(id: number): Promise<ISegment> {
        return this.segmentStore.get(id);
    }

    async getAll(): Promise<ISegment[]> {
        return this.segmentStore.getAll();
    }

    async getActive(): Promise<ISegment[]> {
        return this.segmentStore.getActive();
    }

    async getActiveForClient(): Promise<IClientSegment[]> {
        return this.segmentStore.getActiveForClient();
    }

    // Used by unleash-enterprise.
    async getByStrategy(strategyId: string): Promise<ISegment[]> {
        return this.segmentStore.getByStrategy(strategyId);
    }

    // Used by unleash-enterprise.
    async getStrategies(id: number): Promise<IFeatureStrategy[]> {
        return this.featureStrategiesStore.getStrategiesBySegment(id);
    }

    async create(
        data: unknown,
        user: Partial<Pick<User, 'username' | 'email'>>,
    ): Promise<ISegment> {
        const input = await segmentSchema.validateAsync(data);
        this.validateSegmentValuesLimit(input);
        await this.validateName(input.name);
        const segment = await this.segmentStore.create(input, user);

        await this.eventStore.store({
            type: SEGMENT_CREATED,
            createdBy: user.email || user.username,
            data: segment,
        });

        return segment;
    }

    async update(
        id: number,
        data: unknown,
        user: Partial<Pick<User, 'username' | 'email'>>,
    ): Promise<void> {
        const input = await segmentSchema.validateAsync(data);
        this.validateSegmentValuesLimit(input);
        const preData = await this.segmentStore.get(id);

        if (preData.name !== input.name) {
            await this.validateName(input.name);
        }

        await this.validateSegmentProject(id, input);

        const segment = await this.segmentStore.update(id, input);

        await this.eventStore.store({
            type: SEGMENT_UPDATED,
            createdBy: user.email || user.username,
            data: segment,
            preData,
        });
    }

    async delete(id: number, user: User): Promise<void> {
        const segment = await this.segmentStore.get(id);
        await this.segmentStore.delete(id);
        await this.eventStore.store({
            type: SEGMENT_DELETED,
            createdBy: user.email || user.username,
            data: segment,
        });
    }

    async cloneStrategySegments(
        sourceStrategyId: string,
        targetStrategyId: string,
    ): Promise<void> {
        const sourceStrategySegments = await this.getByStrategy(
            sourceStrategyId,
        );
        await Promise.all(
            sourceStrategySegments.map((sourceStrategySegment) => {
                return this.addToStrategy(
                    sourceStrategySegment.id,
                    targetStrategyId,
                );
            }),
        );
    }

    // Used by unleash-enterprise.
    async addToStrategy(id: number, strategyId: string): Promise<void> {
        await this.validateStrategySegmentLimit(strategyId);
        await this.segmentStore.addToStrategy(id, strategyId);
    }

    async updateStrategySegments(
        strategyId: string,
        segmentIds: number[],
    ): Promise<void> {
        if (segmentIds.length > this.config.strategySegmentsLimit) {
            throw new BadDataError(
                `Strategies may not have more than ${this.config.strategySegmentsLimit} segments`,
            );
        }

        const segments = await this.getByStrategy(strategyId);
        const currentSegmentIds = segments.map((segment) => segment.id);

        const segmentIdsToRemove = currentSegmentIds.filter(
            (id) => !segmentIds.includes(id),
        );

        await Promise.all(
            segmentIdsToRemove.map((segmentId) =>
                this.removeFromStrategy(segmentId, strategyId),
            ),
        );

        const segmentIdsToAdd = segmentIds.filter(
            (id) => !currentSegmentIds.includes(id),
        );

        await Promise.all(
            segmentIdsToAdd.map((segmentId) =>
                this.addToStrategy(segmentId, strategyId),
            ),
        );
    }

    // Used by unleash-enterprise.
    async removeFromStrategy(id: number, strategyId: string): Promise<void> {
        await this.segmentStore.removeFromStrategy(id, strategyId);
    }

    async validateName(name: string): Promise<void> {
        if (!name) {
            throw new BadDataError('Segment name cannot be empty');
        }

        if (await this.segmentStore.existsByName(name)) {
            throw new NameExistsError('Segment name already exists');
        }
    }

    private async validateStrategySegmentLimit(
        strategyId: string,
    ): Promise<void> {
        const { strategySegmentsLimit } = this.config;

        if (
            (await this.getByStrategy(strategyId)).length >=
            strategySegmentsLimit
        ) {
            throw new BadDataError(
                `Strategies may not have more than ${strategySegmentsLimit} segments`,
            );
        }
    }

    private validateSegmentValuesLimit(segment: Omit<ISegment, 'id'>): void {
        const { segmentValuesLimit } = this.config;

        const valuesCount = segment.constraints
            .flatMap((constraint) => constraint.values?.length ?? 0)
            .reduce((acc, length) => acc + length, 0);

        if (valuesCount > segmentValuesLimit) {
            throw new BadDataError(
                `Segments may not have more than ${segmentValuesLimit} values`,
            );
        }
    }

    private async validateSegmentProject(
        id: number,
        segment: Omit<ISegment, 'id'>,
    ): Promise<void> {
        const strategies =
            await this.featureStrategiesStore.getStrategiesBySegment(id);

        const projectsUsed = new Set(
            strategies.map((strategy) => strategy.projectId),
        );

        if (
            segment.project &&
            (projectsUsed.size > 1 ||
                (projectsUsed.size === 1 && !projectsUsed.has(segment.project)))
        ) {
            throw new BadDataError(
                `Invalid project. Segment is being used by strategies in other projects: ${Array.from(
                    projectsUsed,
                ).join(', ')}`,
            );
        }
    }
}
