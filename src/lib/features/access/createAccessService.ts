import { Db, IUnleashConfig } from 'lib/server-impl';
import EventStore from '../../db/event-store';
import GroupStore from '../../db/group-store';
import { AccountStore } from '../../db/account-store';
import RoleStore from '../../db/role-store';
import EnvironmentStore from '../../db/environment-store';
import { AccessStore } from '../../db/access-store';
import { AccessService, EventService, GroupService } from '../../services';
import FakeGroupStore from '../../../test/fixtures/fake-group-store';
import FakeEventStore from '../../../test/fixtures/fake-event-store';
import { FakeAccountStore } from '../../../test/fixtures/fake-account-store';
import FakeRoleStore from '../../../test/fixtures/fake-role-store';
import FakeEnvironmentStore from '../../../test/fixtures/fake-environment-store';
import FakeAccessStore from '../../../test/fixtures/fake-access-store';
import FeatureTagStore from '../../db/feature-tag-store';
import FakeFeatureTagStore from '../../../test/fixtures/fake-feature-tag-store';

export const createAccessService = (
    db: Db,
    config: IUnleashConfig,
): AccessService => {
    const { eventBus, getLogger, flagResolver } = config;
    const eventStore = new EventStore(db, getLogger);
    const groupStore = new GroupStore(db);
    const accountStore = new AccountStore(db, getLogger);
    const roleStore = new RoleStore(db, eventBus, getLogger);
    const environmentStore = new EnvironmentStore(db, eventBus, getLogger);
    const accessStore = new AccessStore(db, eventBus, getLogger);
    const featureTagStore = new FeatureTagStore(db, eventBus, getLogger);
    const eventService = new EventService(
        { eventStore, featureTagStore },
        config,
    );
    const groupService = new GroupService(
        { groupStore, accountStore },
        { getLogger },
        eventService,
    );

    return new AccessService(
        { accessStore, accountStore, roleStore, environmentStore, groupStore },
        { getLogger, flagResolver },
        groupService,
    );
};

export const createFakeAccessService = (
    config: IUnleashConfig,
): AccessService => {
    const { getLogger, flagResolver } = config;
    const eventStore = new FakeEventStore();
    const groupStore = new FakeGroupStore();
    const accountStore = new FakeAccountStore();
    const roleStore = new FakeRoleStore();
    const environmentStore = new FakeEnvironmentStore();
    const accessStore = new FakeAccessStore(roleStore);
    const featureTagStore = new FakeFeatureTagStore();
    const eventService = new EventService(
        { eventStore, featureTagStore },
        config,
    );
    const groupService = new GroupService(
        { groupStore, accountStore },
        { getLogger },
        eventService,
    );

    return new AccessService(
        { accessStore, accountStore, roleStore, environmentStore, groupStore },
        { getLogger, flagResolver },
        groupService,
    );
};
