FROM maven:3.9.9-eclipse-temurin-21 AS build
WORKDIR /app

COPY apps/replica/pom.xml ./apps/replica/pom.xml
COPY apps/replica/src ./apps/replica/src

RUN mvn -f apps/replica/pom.xml -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app

COPY --from=build /app/apps/replica/target/replica-1.0.0.jar /app/replica.jar

EXPOSE 3002
CMD ["java", "-jar", "/app/replica.jar"]
